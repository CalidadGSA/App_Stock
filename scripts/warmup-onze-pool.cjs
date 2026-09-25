/**
 * Precalienta el pool MySQL Onze en el proceso Next (mismo globalThis que mysql-stock.ts).
 * Se carga vía createRequire desde instrumentation para no empaquetar mysql2 con Webpack.
 *
 * Uso: require('./warmup-onze-pool.cjs')  (fire-and-forget)
 */
const path = require('path');

try {
  require(path.join(__dirname, '..', 'src', 'load-env'));
} catch {
  // ignore
}

function readEnvMs(name, fallback) {
  const n = parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function onzeSslOption() {
  const mode = String(process.env.ONZE_DB_SSL ?? '').trim().toLowerCase();
  if (mode === 'require' || mode === 'true' || mode === '1') {
    return { ssl: { rejectUnauthorized: false } };
  }
  return {};
}

void (async () => {
  try {
    if (globalThis.__mysqlStockPool) {
      await globalThis.__mysqlStockPool.query('SELECT 1');
      console.log('[warmup] Pool MySQL Onze ya existía; ping OK');
      return;
    }

    const host = process.env.ONZE_DB_HOST;
    const port = parseInt(process.env.ONZE_DB_PORT || '3306', 10);
    const user = process.env.ONZE_DB_USER;
    const password = process.env.ONZE_DB_PASSWORD;
    const database = process.env.ONZE_DB_NAME;
    if (!host || !user || !password || !database) {
      console.warn('[warmup] Pool MySQL Onze omitido: faltan ONZE_DB_*');
      return;
    }

    const mysql = require('mysql2/promise');
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

    await pool.query('SELECT 1');
    globalThis.__mysqlStockPool = pool;
    console.log('[warmup] Pool MySQL Onze precalentado OK');
  } catch (err) {
    console.warn(
      '[warmup] Pool MySQL Onze no disponible al arrancar:',
      err instanceof Error ? err.message : String(err)
    );
  }
})();
