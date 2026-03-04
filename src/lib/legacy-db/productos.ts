/**
 * Servicio de productos desde la base legacy.
 * Consulta de solo lectura por código de barras.
 *
 * En modo 'mock' devuelve datos de prueba.
 * En modo 'mssql' o 'postgres' ejecuta la consulta real.
 *
 * QUERIES A ADAPTAR según tu sistema (PLEX u otro):
 *   - buscarPorCodigoBarras: busca el producto y su stock para una sucursal
 *   - Ajustar los nombres de tabla/columna según tu esquema legacy
 */

import type { ProductoLegacy } from '@/types';
import { getLegacyDbConfig } from './client';

// ------------------------------------------------------------------
// DATOS MOCK  (usados cuando LEGACY_DB_TYPE=mock)
// ------------------------------------------------------------------
const MOCK_PRODUCTOS: ProductoLegacy[] = [
  { producto_id_sistema: 'PRD001', codigo_barras: '7790040005088', descripcion: 'TAFIROL 500MG',    presentacion: 'CAJA x 20 COMP', laboratorio: 'BAGO',       stock_sistema: 48 },
  { producto_id_sistema: 'PRD002', codigo_barras: '7798040805053', descripcion: 'IBUPROFENO 400MG', presentacion: 'CAJA x 20 COMP', laboratorio: 'ROEMMERS',   stock_sistema: 32 },
  { producto_id_sistema: 'PRD003', codigo_barras: '7793640007060', descripcion: 'AMOXICILINA 500MG',presentacion: 'CAJA x 15 CAPS', laboratorio: 'RICHMOND',   stock_sistema: 15 },
  { producto_id_sistema: 'PRD004', codigo_barras: '7790040900116', descripcion: 'PARACETAMOL 500MG',presentacion: 'CAJA x 24 COMP', laboratorio: 'GENFAR',     stock_sistema: 60 },
  { producto_id_sistema: 'PRD005', codigo_barras: '7702001005075', descripcion: 'LOSARTAN 50MG',    presentacion: 'CAJA x 30 COMP', laboratorio: 'BERNABO',    stock_sistema: 22 },
  { producto_id_sistema: 'PRD006', codigo_barras: '7798010360015', descripcion: 'ENALAPRIL 10MG',   presentacion: 'CAJA x 40 COMP', laboratorio: 'NORTHIA',    stock_sistema: 11 },
  { producto_id_sistema: 'PRD007', codigo_barras: '7792397002091', descripcion: 'METFORMINA 850MG', presentacion: 'CAJA x 60 COMP', laboratorio: 'VARIFARMA',  stock_sistema: 34 },
  { producto_id_sistema: 'PRD008', codigo_barras: '7791519003018', descripcion: 'OMEPRAZOL 20MG',   presentacion: 'CAJA x 14 CAPS', laboratorio: 'MONTPELLIER',stock_sistema: 28 },
];

// ------------------------------------------------------------------
// INTERFACE PÚBLICA
// ------------------------------------------------------------------

/**
 * Busca un producto por código de barras y retorna su stock en la sucursal indicada.
 * @param codigoBarras  EAN/código de barras escaneado
 * @param codigoSucursal  Código interno de la sucursal (para filtrar stock)
 */
export async function buscarProductoPorBarras(
  codigoBarras: string,
  codigoSucursal: string
): Promise<ProductoLegacy | null> {
  const config = getLegacyDbConfig();

  if (config.type === 'mock') {
    return mockBuscar(codigoBarras);
  }

  if (config.type === 'mssql') {
    return mssqlBuscar(codigoBarras, codigoSucursal, config);
  }

  if (config.type === 'postgres') {
    return postgresBuscar(codigoBarras, codigoSucursal, config);
  }

  return null;
}

// ------------------------------------------------------------------
// IMPLEMENTACIONES
// ------------------------------------------------------------------

function mockBuscar(codigoBarras: string): ProductoLegacy | null {
  return MOCK_PRODUCTOS.find(p => p.codigo_barras === codigoBarras) ?? null;
}

async function mssqlBuscar(
  codigoBarras: string,
  codigoSucursal: string,
  config: ReturnType<typeof getLegacyDbConfig>
): Promise<ProductoLegacy | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sql = require('mssql');
    const pool = await sql.connect({
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: { encrypt: false, trustServerCertificate: true },
    });

    // ================================================================
    // ADAPTAR ESTA QUERY A TU ESQUEMA LEGACY (PLEX u otro sistema)
    // Ajustar: nombre de tabla, columnas, joins con stock por sucursal
    // ================================================================
    const result = await pool.request()
      .input('barras', sql.VarChar, codigoBarras)
      .input('sucursal', sql.VarChar, codigoSucursal)
      .query(`
        SELECT
          p.codigo_producto   AS producto_id_sistema,
          p.codigo_barras     AS codigo_barras,
          p.descripcion       AS descripcion,
          p.presentacion      AS presentacion,
          p.laboratorio       AS laboratorio,
          ISNULL(s.stock, 0)  AS stock_sistema
        FROM productos p
        LEFT JOIN stock_sucursales s
          ON s.codigo_producto = p.codigo_producto
          AND s.codigo_sucursal = @sucursal
        WHERE p.codigo_barras = @barras
      `);

    if (result.recordset.length === 0) return null;
    const row = result.recordset[0];
    return {
      producto_id_sistema: String(row.producto_id_sistema),
      codigo_barras:       row.codigo_barras,
      descripcion:         row.descripcion,
      presentacion:        row.presentacion ?? null,
      laboratorio:         row.laboratorio ?? null,
      stock_sistema:       Number(row.stock_sistema),
    };
  } catch (err) {
    console.error('[legacy-db mssql]', err);
    return null;
  }
}

async function postgresBuscar(
  codigoBarras: string,
  codigoSucursal: string,
  config: ReturnType<typeof getLegacyDbConfig>
): Promise<ProductoLegacy | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: config.connectionString });

    // ================================================================
    // ADAPTAR ESTA QUERY A TU ESQUEMA LEGACY
    // ================================================================
    const { rows } = await pool.query(
      `SELECT
         p.codigo_producto   AS producto_id_sistema,
         p.codigo_barras,
         p.descripcion,
         p.presentacion,
         p.laboratorio,
         COALESCE(s.stock, 0) AS stock_sistema
       FROM productos p
       LEFT JOIN stock_sucursales s
         ON s.codigo_producto = p.codigo_producto
         AND s.codigo_sucursal = $2
       WHERE p.codigo_barras = $1
       LIMIT 1`,
      [codigoBarras, codigoSucursal]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      producto_id_sistema: String(row.producto_id_sistema),
      codigo_barras:       row.codigo_barras,
      descripcion:         row.descripcion,
      presentacion:        row.presentacion ?? null,
      laboratorio:         row.laboratorio ?? null,
      stock_sistema:       Number(row.stock_sistema),
    };
  } catch (err) {
    console.error('[legacy-db postgres]', err);
    return null;
  }
}
