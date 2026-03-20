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
      const [rows] = await pool.query<StockLegacyRow[]>(
        'SELECT Cantidad AS cantidad, Unidades AS unidades, UnidadesProd AS unidadesprod FROM stock WHERE Sucursal = ? AND IDProducto = ? LIMIT 1',
        [sucursalId, idProducto]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
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
