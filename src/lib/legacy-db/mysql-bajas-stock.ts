/**
 * Bajas de stock desde onze_center.stockmovimientos (Referencia = "Baja de Stock").
 * Solo servidor (API routes).
 */

import {
  SUCURSALES_EXCLUIDAS_LOGIN,
  esSucursalVisibleEnLogin,
} from '@/lib/sucursales/login-sucursales';

export type BajaStockAgregadoRow = {
  sucursal_id: number;
  ym: string;
  movimientos: number;
  cajas: number;
  unidades: number;
  /** SUM(ABS(Cantidad) * Costo) desde medicamentos.Costo por línea de movimiento. */
  valor_total: number;
};

export type QueryBajasStockResult =
  | { status: 'ok'; rows: BajaStockAgregadoRow[] }
  | { status: 'unavailable'; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const globalThis: { __mysqlStockPool?: any };

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
  });
  globalThis.__mysqlStockPool = pool;
  return pool;
}

/**
 * Agrega movimientos por sucursal y mes calendario (Fecha en onze_center = día AR a las 03:00 UTC).
 */
export async function queryBajasStockAgregado(
  desdeIso: string,
  hastaExclusivoIso: string
): Promise<QueryBajasStockResult> {
  const pool = await getPool();
  if (!pool) {
    return { status: 'unavailable', error: 'MySQL Onze no configurado' };
  }

  const excl = SUCURSALES_EXCLUIDAS_LOGIN;
  const placeholders = excl.map(() => '?').join(',');

  try {
    const [rows] = await pool.query(
      `SELECT
         sm.Sucursal AS sucursal_id,
         DATE_FORMAT(sm.Fecha, '%Y-%m') AS ym,
         COUNT(*) AS movimientos,
         SUM(ABS(sm.Cantidad)) AS cajas,
         SUM(ABS(sm.Unidades)) AS unidades,
         SUM(ABS(sm.Cantidad) * COALESCE(m.Costo, 0)) AS valor_total
       FROM stockmovimientos sm
       LEFT JOIN medicamentos m ON m.CodPlex = sm.IDProducto
       WHERE sm.Referencia = 'Baja de Stock'
         AND sm.Sucursal NOT IN (${placeholders})
         AND sm.Fecha >= ?
         AND sm.Fecha < ?
       GROUP BY sm.Sucursal, DATE_FORMAT(sm.Fecha, '%Y-%m')
       ORDER BY ym, sucursal_id`,
      [...excl, desdeIso, hastaExclusivoIso]
    );

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
    return {
      status: 'unavailable',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
