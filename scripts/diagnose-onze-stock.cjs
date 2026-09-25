/**
 * Prueba conectividad MySQL Onze (stock live).
 * En el VPS: npm run onze:diagnose
 */
require('../src/load-env');

const mysql = require('mysql2/promise');

function mask(v) {
  if (!v) return '(vacío)';
  if (v.length <= 2) return '**';
  return `${v.slice(0, 2)}***`;
}

function sslOption() {
  const raw = (process.env.ONZE_DB_SSL ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'require' || raw === 'true') {
    return {
      ssl: { rejectUnauthorized: process.env.ONZE_DB_SSL_REJECT_UNAUTHORIZED !== '0' },
    };
  }
  return {};
}

async function main() {
  const host = process.env.ONZE_DB_HOST;
  const port = parseInt(process.env.ONZE_DB_PORT || '3306', 10);
  const user = process.env.ONZE_DB_USER;
  const password = process.env.ONZE_DB_PASSWORD;
  const database = process.env.ONZE_DB_NAME;
  const legacyType = process.env.LEGACY_DB_TYPE || '(no definido)';

  console.log('=== Diagnóstico MySQL Onze (stock) ===\n');
  console.log('LEGACY_DB_TYPE:', legacyType);
  console.log('ONZE_DB_HOST:', host || '(vacío)');
  console.log('ONZE_DB_PORT:', port);
  console.log('ONZE_DB_NAME:', database || '(vacío)');
  console.log('ONZE_DB_USER:', user || '(vacío)');
  console.log('ONZE_DB_PASSWORD:', password ? mask(password) : '(vacío)');
  console.log('ONZE_DB_SSL:', process.env.ONZE_DB_SSL || '(off)');
  console.log('');

  if (!host || !user || !password || !database) {
    console.error('❌ Faltan ONZE_DB_HOST / USER / PASSWORD / NAME en .env.local');
    process.exit(1);
  }

  const t0 = Date.now();
  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      connectTimeout: 15_000,
      ...sslOption(),
    });
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS n FROM stock LIMIT 1'
    );
    const n = Array.isArray(rows) && rows[0] ? rows[0].n : '?';
    console.log(`✅ Conexión OK en ${Date.now() - t0}ms`);
    console.log('   Filas en stock (COUNT):', n);
    process.exit(0);
  } catch (e) {
    const code = e && e.code ? e.code : '';
    const msg = e && e.message ? e.message : String(e);
    console.error(`❌ Falló en ${Date.now() - t0}ms`);
    console.error('   code:', code || '(sin code)');
    console.error('   message:', msg.slice(0, 300));
    console.error('\nPistas:');
    console.error('- ETIMEDOUT / ECONNREFUSED → firewall/trusted sources: permitir IP pública del VPS');
    console.error('- ER_ACCESS_DENIED_ERROR → user/password o host del usuario MySQL');
    console.error('- HANDSHAKE / SSL → probar ONZE_DB_SSL=1 en .env.local');
    console.error('- Host viejo en el VPS → actualizar ONZE_DB_HOST y: pm2 reload ecosystem.config.cjs --update-env');
    process.exit(1);
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        // ignore
      }
    }
  }
}

main();
