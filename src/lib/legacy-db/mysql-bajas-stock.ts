/**
 * Bajas de stock desde onze_center: `stock_operaciones` + `stock_operaciones_detalle`,
 * filtrando los motivos de baja (`stock_operaciones_motivos.alta_baja = 'B'`).
 *
 * El mes se asigna por **fecha de carga de la operación** (`stock_operaciones.FechaHora`),
 * igual que los KPIs mensuales. Antes se leía `stockmovimientos` (Referencia = "Baja de Stock"),
 * cuya fecha es la del movimiento de stock y no coincide con la de carga: por eso los totales
 * de un mes no daban iguales entre las dos vistas.
 *
 * Valorizadas con el costo de la línea (o `Precio × 0,65` si no hay costo cargado).
 * Solo servidor (API routes).
 *
 * Si Onze no responde (túnel caído, red, etc.) falla rápido con `unavailable`
 * para no colgar el informe mensual entero.
 */

import {
  SUCURSALES_EXCLUIDAS_LOGIN,
  esSucursalVisibleEnLogin,
} from '@/lib/sucursales/login-sucursales';
import { sqlCostoConFallback } from '@/lib/legacy-db/onze-medicamentos';

export type BajaStockAgregadoRow = {
  sucursal_id: number;
  ym: string;
  /** Líneas de baja (una por producto dentro de cada operación). */
  movimientos: number;
  cajas: number;
  unidades: number;
  /** SUM(cajas equivalentes × costo de la línea, con fallback `Precio × 0,65`). */
  valor_total: number;
};

export type QueryBajasStockResult =
  | { status: 'ok'; rows: BajaStockAgregadoRow[] }
  | { status: 'unavailable'; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const globalThis: { __mysqlStockPool?: any };

/** Cantidad en cajas incluyendo la fracción de unidades sueltas (igual que los KPIs). */
const SQL_CAJAS_EQUIV =
  '(d.Cantidad + CASE WHEN d.UnidadesProducto > 0 AND d.Unidades > 0 THEN d.Unidades / d.UnidadesProducto ELSE 0 END)';

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 8_000;

function readEnvMs(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getConnectTimeoutMs(): number {
  return readEnvMs('ONZE_DB_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS);
}

function getBajasQueryTimeoutMs(): number {
  return readEnvMs('ONZE_BAJAS_QUERY_TIMEOUT_MS', DEFAULT_QUERY_TIMEOUT_MS);
}

async function resetPool() {
  const pool = globalThis.__mysqlStockPool;
  globalThis.__mysqlStockPool = undefined;
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // Pool ya roto: ignoramos para recrearlo limpio.
  }
}

function onzeSslOption(): { ssl: { rejectUnauthorized: boolean } } | Record<string, never> {
  const raw = (process.env.ONZE_DB_SSL ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'require' || raw === 'true') {
    return {
      ssl: { rejectUnauthorized: process.env.ONZE_DB_SSL_REJECT_UNAUTHORIZED !== '0' },
    };
  }
  return {};
}

async function getPool() {
  if (globalThis.__mysqlStockPool) return globalThis.__mysqlStockPool;
  const mysql = await import('mysql2/promise');
  const host = process.env.ONZE_DB_HOST;
  const port = parseInt(process.env.ONZE_DB_PORT || '3306', 10);
  const user = process.env.ONZE_DB_USER;
  const password = process.env.ONZE_DB_PASSWORD;
  const database = process.env.ONZE_DB_NAME;
  if (!host || !user || !password || !database) return null;
  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: getConnectTimeoutMs(),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ...onzeSslOption(),
  });
  globalThis.__mysqlStockPool = pool;
  return pool;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timeout (${ms}ms)`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Agrega las bajas por sucursal y mes calendario.
 * Las fechas van en `YYYY-MM-DD` de calendario Argentina (`FechaHora` es hora local),
 * con `hastaExclusivoYmd` fuera del rango.
 */
export async function queryBajasStockAgregado(
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<QueryBajasStockResult> {
  const pool = await getPool();
  if (!pool) {
    return { status: 'unavailable', error: 'MySQL Onze no configurado' };
  }

  const excl = SUCURSALES_EXCLUIDAS_LOGIN;
  const placeholders = excl.map(() => '?').join(',');
  const timeoutMs = getBajasQueryTimeoutMs();

  try {
    const queryResult = await withTimeout(
      pool.query(
        `SELECT
           o.Sucursal AS sucursal_id,
           DATE_FORMAT(o.FechaHora, '%Y-%m') AS ym,
           COUNT(*) AS movimientos,
           SUM(d.Cantidad) AS cajas,
           SUM(d.Unidades) AS unidades,
           SUM(${SQL_CAJAS_EQUIV} * ${sqlCostoConFallback('d.Costo', 'd.Precio')}) AS valor_total
         FROM stock_operaciones o
         INNER JOIN stock_operaciones_detalle d ON d.IDOperacion = o.IDOperacion
         INNER JOIN stock_operaciones_motivos mo ON mo.idMotivoOpStock = o.idMotivoOpStock
         WHERE mo.alta_baja = 'B'
           AND o.Sucursal NOT IN (${placeholders})
           AND o.FechaHora >= ?
           AND o.FechaHora < ?
         GROUP BY o.Sucursal, DATE_FORMAT(o.FechaHora, '%Y-%m')
         ORDER BY ym, sucursal_id`,
        [...excl, desdeYmd, hastaExclusivoYmd]
      ) as Promise<[unknown, unknown]>,
      timeoutMs,
      'Onze bajas de stock'
    );
    const rows = queryResult[0];

    const out: BajaStockAgregadoRow[] = [];
    for (const r of rows as Array<{
      sucursal_id: number;
      ym: string;
      movimientos: string | number;
      cajas: string | number;
      unidades: string | number;
      valor_total: string | number;
    }>) {
      const sucursal_id = Number(r.sucursal_id);
      if (!esSucursalVisibleEnLogin(sucursal_id)) continue;
      out.push({
        sucursal_id,
        ym: String(r.ym ?? '').trim(),
        movimientos: Number(r.movimientos ?? 0),
        cajas: Number(r.cajas ?? 0),
        unidades: Number(r.unidades ?? 0),
        valor_total: Number(r.valor_total ?? 0),
      });
    }

    return { status: 'ok', rows: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Si el host no responde, el pool puede quedar en mal estado: lo regeneramos.
    if (/timeout|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(msg)) {
      void resetPool();
    }
    return {
      status: 'unavailable',
      error: msg,
    };
  }
}
