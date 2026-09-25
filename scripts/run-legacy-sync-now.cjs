/**
 * Una corrida manual del lote sync legacy → Supabase (fuera del bundle Next/Turbopack).
 * Uso: node scripts/run-legacy-sync-now.cjs
 */
const path = require('path');

require(path.join(__dirname, '..', 'src', 'load-env'));

const { runLegacySyncBatch } = require(path.join(
  __dirname,
  '..',
  'src',
  'jobs',
  'obrasSocialesSync.job'
));

runLegacySyncBatch()
  .then(() => {
    console.log('✅ Sync legacy manual finalizado');
    process.exit(0);
  })
  .catch((e) => {
    console.error('❌ Sync legacy manual falló:', e);
    process.exit(1);
  });
