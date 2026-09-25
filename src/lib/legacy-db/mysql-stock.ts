/**
 * Lectura de stock desde la base MySQL externa (Onze Center).
 * Usa las variables de .env.local: ONZE_DB_HOST, ONZE_DB_PORT, ONZE_DB_USER, ONZE_DB_PASSWORD, ONZE_DB_NAME.
 * Solo para uso en servidor (API routes).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const globalThis: { __mysqlStockPool?: any };

function readEnvMs(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Timeout por intento al consultar stock live (API productos / diferencias). */
export const DEFAULT_STOCK_QUERY_TIMEOUT_MS = 12_000;

export function getStockQueryTimeoutMs(): number {
  return readEnvMs('ONZE_STOCK_QUERY_TIMEOUT_MS', DEFAULT_STOCK_QUERY_TIMEOUT_MS);
}

export interface StockLegacyRow {
  cantidad: number;
  unidades: number;
  unidadesprod: number;
}

export type StockLegacyLookupResult =
  | { status: 'ok'; row: StockLegacyRow | null }
  | { status: 'unavailable'; error: unknown };

function isTransientMySqlError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code ?? '') : '';
  return [
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ETIMEDOUT',
    'ECONNREFUSED',
  ].includes(code);
}

async function resetPool() {
  const pool = globalThis.__mysqlStockPool;
  globalThis.__mysqlStockPool = undefined;
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // Si el pool ya quedó roto, ignoramos el error para recrearlo limpio.
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
  if (!host || !user || !password || !database) {
    return null;
  }
  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    connectTimeout: readEnvMs('ONZE_DB_CONNECT_TIMEOUT_MS', 15_000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ...onzeSslOption(),
  });
  globalThis.__mysqlStockPool = pool;
  return pool;
}

/** Pool compartido de Onze para otras lecturas (ventas, bajas). Null si falta configuración. */
export async function getOnzePool() {
  return getPool();
}

/** Cierra el pool (scripts/jobs one-shot: sin esto el proceso queda vivo por el keep-alive). */
export async function cerrarOnzePool(): Promise<void> {
  await resetPool();
}

/**
 * Obtiene el stock de un producto en una sucursal desde la base MySQL externa.
 * Tabla: stock (Sucursal, IDProducto, Cantidad, Unidades, UnidadesProd).
 */
export async function getStockFromLegacyDetailed(
  sucursalId: number,
  idProducto: number
): Promise<StockLegacyLookupResult> {
  for (let intento = 1; intento <= 2; intento += 1) {
    const pool = await getPool();
    if (!pool) {
      return { status: 'unavailable', error: new Error('Configuración MySQL incompleta') };
    }

    try {
      const [rows] = await pool.query(
        'SELECT Cantidad AS cantidad, Unidades AS unidades, UnidadesProd AS unidadesprod FROM stock WHERE Sucursal = ? AND IDProducto = ? LIMIT 1',
        [sucursalId, idProducto]
      );
      const typedRows = rows as StockLegacyRow[];
      const row = Array.isArray(typedRows) ? typedRows[0] : null;
      return { status: 'ok', row: row ?? null };
    } catch (err) {
      console.error('Error leyendo stock desde MySQL legacy:', err);

      if (intento === 1 && isTransientMySqlError(err)) {
        await resetPool();
        continue;
      }

      return { status: 'unavailable', error: err };
    }
  }

  return { status: 'unavailable', error: new Error('No se pudo consultar MySQL legacy') };
}

export async function getStockFromLegacy(
  sucursalId: number,
  idProducto: number
): Promise<StockLegacyRow | null> {
  const result = await getStockFromLegacyDetailed(sucursalId, idProducto);
  return result.status === 'ok' ? result.row : null;
}

/** Resultado de la carrera timeout vs consulta MySQL (API productos). */
export type StockLegacyRaceResult =
  | StockLegacyLookupResult
  | { status: 'timeout' };

/**
 * Convierte la respuesta legacy en campos de stock para la API.
 * Con `allowMissingStock`, solo asume 0 si la consulta respondió OK y no hay fila en `stock`.
 * Timeout, MySQL caído o errores transitorios nunca devuelven 0 (evita confundir con stock real).
 */
export function legacyStockRaceToSistemaFields(
  stockResult: StockLegacyRaceResult,
  allowMissingStock: boolean
):
  | {
      ok: true;
      stock_sistema: number;
      stock_cajas: number;
      stock_unidades: number;
      unidades_por_caja: number;
    }
  | { ok: false } {
  if (stockResult.status === 'ok' && stockResult.row) {
    const stockRow = stockResult.row;
    const cajas = Number(stockRow.cantidad ?? 0);
    const unidadesSueltas = Number(stockRow.unidades ?? 0);
    const unidadesProd = Number(stockRow.unidadesprod ?? 0) || 1;
    return {
      ok: true,
      stock_cajas: cajas,
      stock_unidades: unidadesSueltas,
      unidades_por_caja: unidadesProd,
      stock_sistema: cajas * unidadesProd + unidadesSueltas,
    };
  }

  if (stockResult.status === 'ok' && !stockResult.row) {
    if (allowMissingStock) {
      return {
        ok: true,
        stock_cajas: 0,
        stock_unidades: 0,
        unidades_por_caja: 1,
        stock_sistema: 0,
      };
    }
    return { ok: false };
  }

  return { ok: false };
}

export type StockmovimientosHealthResult =
  | { ok: true; latencyMs: number }
  | { ok: false; latencyMs: number; error: string };

/**
 * Consulta liviana para comprobar latencia/disponibilidad de Onze (misma DB que stock).
 * Query acordada con operación: último movimiento de stock.
 */
export async function queryStockmovimientosHealthCheck(
  timeoutMs: number
): Promise<StockmovimientosHealthResult> {
  const t0 = Date.now();
  try {
    const pool = await getPool();
    if (!pool) {
      return { ok: false, latencyMs: Date.now() - t0, error: 'MySQL Onze no configurado' };
    }
    const q = pool.query(
      'SELECT * FROM stockmovimientos ORDER BY IDMovimiento DESC LIMIT 1'
    );
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
    );
    await Promise.race([q, timeout]);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: String((e as Error).message) };
  }
}
