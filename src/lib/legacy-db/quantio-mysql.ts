import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function isQuantioDatabaseConfigured(): boolean {
  return Boolean(
    process.env.QUANTIO_DB_HOST &&
      process.env.QUANTIO_DB_USER &&
      process.env.QUANTIO_DB_PASSWORD &&
      process.env.QUANTIO_DB_NAME
  );
}

export function getQuantioPool(): mysql.Pool {
  if (pool) return pool;

  const host = process.env.QUANTIO_DB_HOST;
  const user = process.env.QUANTIO_DB_USER;
  const password = process.env.QUANTIO_DB_PASSWORD;
  const database = process.env.QUANTIO_DB_NAME;

  if (!host || !user || !password || !database) {
    throw new Error('Variables QUANTIO_DB_* incompletas');
  }

  const port = parseInt(process.env.QUANTIO_DB_PORT || '3306', 10);

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10_000,
    ...(process.env.QUANTIO_DB_SSL === '1' || process.env.QUANTIO_DB_SSL === 'require'
      ? { ssl: { rejectUnauthorized: process.env.QUANTIO_DB_SSL_REJECT_UNAUTHORIZED !== '0' } }
      : {}),
  });

  return pool;
}

export async function testQuantioConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isQuantioDatabaseConfigured()) {
    return { ok: false, error: 'Variables QUANTIO_DB_* incompletas' };
  }

  try {
    const p = getQuantioPool();
    await p.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
