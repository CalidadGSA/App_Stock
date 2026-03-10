/**
 * Lectura de stock desde la base MySQL externa (Onze Center).
 * Usa las variables de .env.local: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
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
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
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
