/**
 * Proceso dedicado al cron legacy (PM2 gestionstock-cron o fork desde Next).
 * No importar este archivo desde código que Next compile.
 */
require('../load-env');

const inst = process.env.NODE_APP_INSTANCE;
if (inst != null && inst !== '' && inst !== '0') {
  console.log(`⏭️ Cron legacy runner omitido en instancia PM2 ${inst}`);
  process.exit(0);
}

const { startLegacySyncCron, resolveCronExpression, TZ } = require('./obrasSocialesSync.job');

console.log('🚀 Iniciando proceso cron legacy…');
console.log(`   cwd=${process.cwd()}`);
console.log(`   TZ=${TZ} | cron=${resolveCronExpression()}`);

try {
  const task = startLegacySyncCron();
  if (!task) {
    console.error('❌ No se registró ninguna tarea cron. Revisá SYNC_CRON_* en .env del servidor.');
    process.exit(1);
  }
  console.log('✅ Proceso cron legacy en espera de ejecuciones programadas.');
} catch (err) {
  console.error('❌ Falló el arranque del cron legacy:', err);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection en cron legacy:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException en cron legacy:', err);
});
