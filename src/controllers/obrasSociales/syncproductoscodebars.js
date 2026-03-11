require('dotenv').config();

const mysql = require('mysql2/promise');
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

/**
 * Sync de códigos de barras múltiples por producto desde la base Quantio hacia Supabase.
 * Tabla origen (Quantio): productoscodebars (IDProducto, codebar)
 * Tabla destino (Supabase): productoscodebars (idproducto, codebar)
 */

async function getQuantioPool() {
  const host = process.env.QUANTIO_DB_HOST;
  const port = parseInt(process.env.QUANTIO_DB_PORT || '3306', 10);
  const user = process.env.QUANTIO_DB_USER;
  const password = process.env.QUANTIO_DB_PASSWORD;
  const database = process.env.QUANTIO_DB_NAME;

  if (!host || !user || !password || !database) {
    console.warn(
      '⚠️ Variables QUANTIO_DB_* incompletas, se omite conexión a Quantio para productoscodebars'
    );
    return null;
  }

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
}

async function syncProductosCodebarsFromQuantio() {
  const pool = await getQuantioPool();
  if (!pool) {
    return { total: 0, processed: 0 };
  }

  const supabase = getSupabaseAdmin();

  try {
    const [rows] = await pool.query(
      'SELECT IDProducto, codebar FROM productoscodebars'
    );

    let processed = 0;

    for (const r of rows) {
      const { error } = await supabase
        .from('productoscodebars')
        .upsert(
          {
            idproducto: r.IDProducto,
            codebar: r.codebar,
          },
          { onConflict: 'idproducto,codebar' }
        );

      if (error) {
        // eslint-disable-next-line no-console
        console.error(
          '[syncProductosCodebarsFromQuantio] Error upsert',
          r.IDProducto,
          r.codebar,
          error.message
        );
        continue;
      }

      processed += 1;
    }

    return { total: rows.length, processed };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('💥 Error en sync productoscodebars desde Quantio:', e);
    throw e;
  }
}

module.exports = {
  syncProductosCodebarsFromQuantio,
};

