const dbInterna = require('../../dbInterna');

async function ensureObrasSociales() {
  // Crear tabla obsociales
  await dbInterna.query(`
    CREATE TABLE IF NOT EXISTS obsociales (
      codobsoc SERIAL PRIMARY KEY,
      descripcio VARCHAR(255)
    );
  `);

  // Crear tabla sync_status
  await dbInterna.query(`
    CREATE TABLE IF NOT EXISTS sync_status (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE,
      completed BOOLEAN,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Crear tabla audit_log
  await dbInterna.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      entity TEXT,
      action TEXT,
      status TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('📦 Tablas Obras Sociales, sync_status y audit_log OK');
}

module.exports = { ensureObrasSociales };