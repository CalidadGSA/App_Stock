require('dotenv').config();

const mysql = require('mysql2/promise');
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(
  process.env.BATCH_SIZE_PRODUCTOSCODEBARS || '2000',
  10
);

let syncProductosCodebarsState = {
  entity: 'productoscodebars',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

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

function buildQuantioConfig() {
  return {
    host: process.env.QUANTIO_DB_HOST || null,
    port: parseInt(process.env.QUANTIO_DB_PORT || '3306', 10),
    database: process.env.QUANTIO_DB_NAME || null,
    user: process.env.QUANTIO_DB_USER || null,
  };
}

function mapQuantioConnectionError(error) {
  switch (error?.code) {
    case 'ECONNREFUSED':
      return 'No se pudo abrir conexión TCP con Quantio. El host responde, pero el puerto configurado rechaza la conexión.';
    case 'ETIMEDOUT':
      return 'La conexión a Quantio expiró. Revisá red, firewall o accesibilidad del servidor.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'Quantio rechazó las credenciales. Revisá usuario y contraseña.';
    case 'ER_BAD_DB_ERROR':
      return 'La base configurada no existe en el servidor Quantio.';
    default:
      return error?.message || 'Error desconocido al conectar con Quantio.';
  }
}

async function testQuantioConnection() {
  const config = buildQuantioConfig();
  const faltantes = [];

  if (!config.host) faltantes.push('QUANTIO_DB_HOST');
  if (!config.user) faltantes.push('QUANTIO_DB_USER');
  if (!process.env.QUANTIO_DB_PASSWORD) faltantes.push('QUANTIO_DB_PASSWORD');
  if (!config.database) faltantes.push('QUANTIO_DB_NAME');

  if (faltantes.length > 0) {
    return {
      ok: false,
      message: `Faltan variables de entorno de Quantio: ${faltantes.join(', ')}`,
      config,
    };
  }

  let pool = null;
  const startedAt = Date.now();

  try {
    pool = await getQuantioPool();
    if (!pool) {
      return {
        ok: false,
        message: 'No se pudo crear el pool de conexión a Quantio.',
        config,
      };
    }

    const [pingRows] = await pool.query('SELECT 1 AS ok');
    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM productoscodebars'
    );

    return {
      ok: true,
      message: 'Conexión a Quantio OK.',
      config,
      latencyMs: Date.now() - startedAt,
      diagnostics: {
        ping: pingRows?.[0]?.ok === 1,
        productoscodebarsTotal: Number(countRows?.[0]?.total || 0),
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: mapQuantioConnectionError(error),
      config,
      latencyMs: Date.now() - startedAt,
      error: {
        code: error?.code || null,
        errno: error?.errno || null,
      },
    };
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

async function syncProductosCodebarsFromQuantio({ limit: limitParam } = {}) {
  const effectiveLimit =
    typeof limitParam === 'number' && limitParam > 0 ? limitParam : SYNC_LIMIT;

  if (syncProductosCodebarsState.inProgress) {
    console.log('⏸️ Sync productoscodebars ya en progreso');
    return {
      processed: syncProductosCodebarsState.processed,
      total: syncProductosCodebarsState.total,
    };
  }

  syncProductosCodebarsState.inProgress = true;
  syncProductosCodebarsState.completed = false;
  syncProductosCodebarsState.total = 0;
  syncProductosCodebarsState.processed = 0;
  syncProductosCodebarsState.startedAt = new Date();
  syncProductosCodebarsState.batchNumber = 0;

  let pool = null;

  try {
    pool = await getQuantioPool();
    if (!pool) {
      return { total: 0, processed: 0 };
    }

    const supabase = getSupabaseAdmin();
    const startTime = Date.now();

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM productoscodebars'
    );
    const totalExterno = Number(countRows[0]?.total || 0);
    syncProductosCodebarsState.total =
      effectiveLimit > 0
        ? Math.min(effectiveLimit, totalExterno)
        : totalExterno;

    let lastIdProducto = -1;
    let lastCodebar = '';
    let batchNumber = 0;

    while (syncProductosCodebarsState.processed < syncProductosCodebarsState.total) {
      batchNumber += 1;
      syncProductosCodebarsState.batchNumber = batchNumber;

      const remaining = syncProductosCodebarsState.total - syncProductosCodebarsState.processed;
      const fetchLimit = Math.min(BATCH_SIZE, remaining);

      const [rows] = await pool.query(
        `
          SELECT IDProducto, codebar
          FROM productoscodebars
          WHERE (IDProducto > ?)
             OR (IDProducto = ? AND codebar > ?)
          ORDER BY IDProducto, codebar
          LIMIT ?
        `,
        [lastIdProducto, lastIdProducto, lastCodebar, fetchLimit]
      );

      if (!rows.length) {
        break;
      }

      const seen = new Set();
      const batchToUpsert = [];

      for (const row of rows) {
        const idproducto = Number(row.IDProducto);
        const codebar = typeof row.codebar === 'string' ? row.codebar.trim() : '';

        lastIdProducto = idproducto;
        lastCodebar = codebar;

        if (!Number.isFinite(idproducto) || !codebar) {
          continue;
        }

        const key = `${idproducto}::${codebar}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        batchToUpsert.push({ idproducto, codebar });
      }

      if (batchToUpsert.length > 0) {
        const { error } = await supabase
          .from('productoscodebars')
          .upsert(batchToUpsert, { onConflict: 'idproducto,codebar' });

        if (error) {
          console.error(
            `[syncProductosCodebarsFromQuantio] Error en lote #${batchNumber}:`,
            error.message
          );
          throw error;
        }
      }

      syncProductosCodebarsState.processed += rows.length;
      console.log(
        `✅ Lote productoscodebars #${batchNumber} confirmado — procesados: ${syncProductosCodebarsState.processed}/${syncProductosCodebarsState.total}`
      );
    }

    syncProductosCodebarsState.completed = true;

    return {
      total: syncProductosCodebarsState.total,
      processed: syncProductosCodebarsState.processed,
      duration: ((Date.now() - startTime) / 1000).toFixed(1),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('💥 Error en sync productoscodebars desde Quantio:', e);
    throw e;
  } finally {
    syncProductosCodebarsState.inProgress = false;
    if (pool) {
      await pool.end();
    }
  }
}

module.exports = {
  testQuantioConnection,
  syncProductosCodebarsFromQuantio,
  syncProductosCodebarsState,
};

