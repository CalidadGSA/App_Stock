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
export async function getStockFromLegacy(
  sucursalId: number,
  idProducto: number
): Promise<StockLegacyRow | null> {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query<StockLegacyRow[]>(
      'SELECT Cantidad AS cantidad, Unidades AS unidades, UnidadesProd AS unidadesprod FROM stock WHERE Sucursal = ? AND IDProducto = ? LIMIT 1',
      [sucursalId, idProducto]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ?? null;
  } catch (err) {
    console.error('Error leyendo stock desde MySQL legacy:', err);
    return null;
  }
}
