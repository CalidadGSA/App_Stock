require('dotenv').config();

const mysql = require('mysql2/promise');

/**
 * Conexión a base legacy (Onze Center).
 * Controlada por LEGACY_DB_TYPE:
 *  - mysql → usa la base externa real
 *  - cualquier otro valor → modo mock (no hace nada)
 */
const dbType = process.env.LEGACY_DB_TYPE || 'mock';

let pool;

if (dbType === 'mysql') {
  pool = mysql.createPool({
    host: process.env.ONZE_DB_HOST,
    port: parseInt(process.env.ONZE_DB_PORT || '3306', 10),
    user: process.env.ONZE_DB_USER,
    password: process.env.ONZE_DB_PASSWORD,
    database: process.env.ONZE_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  console.log('✅ Conectado a base legacy MySQL');
} else {
  // Pool mock para entornos sin DB legacy
  pool = {
    query: async () => {
      console.warn('⚠️ pool.query llamado con LEGACY_DB_TYPE != mysql (modo mock)');
      return [[], []];
    },
  };
  console.log(`ℹ️ LEGACY_DB_TYPE=${dbType} → pool mock (sin conexión MySQL)`);
}

module.exports = { pool, dbType };

