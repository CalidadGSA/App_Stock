/**
 * Lectura de stock desde la base MySQL externa (Onze Center).
 * Usa las variables de .env.local: ONZE_DB_HOST, ONZE_DB_PORT, ONZE_DB_USER, ONZE_DB_PASSWORD, ONZE_DB_NAME.
 * Solo para uso en servidor (API routes).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const globalThis: { __mysqlStockPool?: any };

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
    connectionLimit: 5,
    queueLimit: 0,
  });
  globalThis.__mysqlStockPool = pool;
  return pool;
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
 * Si `allowMissingStock` es true (p. ej. inventario ocasional), no hay 503 por fila ausente,
 * timeout o MySQL caído: se asume 0 para poder cargar la ficha y contar físico.
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
  if (
    allowMissingStock &&
    (stockResult.status === 'timeout' ||
      (stockResult.status === 'ok' && !stockResult.row) ||
      stockResult.status === 'unavailable')
  ) {
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

export interface VentaPosteriorInput {
  detalleId: string;
  sucursalId: number;
  productoId: number;
  fechaRegistroIso: string;
}

/**
 * Marca si existe al menos una venta (factcabecera/factlineas) posterior a la carga de la línea.
 */
export async function getVentaPosteriorFlagsForDetalles(
  detalles: VentaPosteriorInput[]
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (detalles.length === 0) return out;

  const limpios = detalles.filter(
    (d) =>
      Number.isFinite(d.sucursalId) &&
      Number.isFinite(d.productoId) &&
      !!String(d.fechaRegistroIso ?? '').trim()
  );
  if (limpios.length === 0) return out;

  const minRegistro = limpios
    .map((d) => String(d.fechaRegistroIso))
    .sort((a, b) => a.localeCompare(b))[0];
  const idsSuc = Array.from(new Set(limpios.map((d) => d.sucursalId)));
  const idsProd = Array.from(new Set(limpios.map((d) => d.productoId)));

  for (const d of limpios) out.set(d.detalleId, false);

  const pool = await getPool();
  if (!pool || !minRegistro) return out;

  try {
    const [rows] = await pool.query(
      `SELECT
         fc.Sucursal AS sucursal,
         fl.IDProducto AS producto_id,
         MAX(TIMESTAMP(fc.Emision, COALESCE(fc.Hora, '00:00:00'))) AS ultima_venta
       FROM factlineas fl
       INNER JOIN factcabecera fc ON fc.IDComprobante = fl.IDComprobante
       WHERE fc.Sucursal IN (?)
         AND fl.IDProducto IN (?)
         AND TIMESTAMP(fc.Emision, COALESCE(fc.Hora, '00:00:00')) >= ?
       GROUP BY fc.Sucursal, fl.IDProducto`,
      [idsSuc, idsProd, minRegistro]
    );

    const ultimaByKey = new Map<string, string>();
    for (const r of rows as Array<{ sucursal: number; producto_id: number; ultima_venta: string | Date | null }>) {
      const key = `${Number(r.sucursal)}::${Number(r.producto_id)}`;
      const val = r.ultima_venta
        ? new Date(r.ultima_venta as string | Date).toISOString()
        : '';
      if (val) ultimaByKey.set(key, val);
    }

    for (const d of limpios) {
      const key = `${d.sucursalId}::${d.productoId}`;
      const ultima = ultimaByKey.get(key);
      if (!ultima) continue;
      const tUlt = new Date(ultima).getTime();
      const tReg = new Date(String(d.fechaRegistroIso)).getTime();
      out.set(d.detalleId, Number.isFinite(tUlt) && Number.isFinite(tReg) && tUlt > tReg);
    }
    return out;
  } catch (err) {
    console.error('Error leyendo ventas posteriores desde MySQL legacy:', err);
    return out;
  }
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
