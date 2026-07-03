/**
 * Diagnóstico del cron legacy (ejecutar en el VPS: npm run cron:diagnose).
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

require('../src/load-env');

const root = process.cwd();
const TZ = (process.env.TZ || 'America/Argentina/Buenos_Aires').trim();

function resolveCronExpression() {
  const raw =
    process.env.SYNC_CRON_DATOS ||
    process.env.SYNC_CRON_SUCURSALES ||
    process.env.SYNC_CRON_sucursales ||
    '45 3 * * *';
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

const expr = resolveCronExpression();
const now = new Date();

console.log('=== Diagnóstico cron sync legacy ===\n');
console.log('cwd:', root);
console.log('.env existe:', fs.existsSync(path.join(root, '.env')));
console.log('.env.local existe:', fs.existsSync(path.join(root, '.env.local')));
console.log('PID:', process.pid);
console.log('NODE_APP_INSTANCE:', process.env.NODE_APP_INSTANCE ?? '(no definido)');
console.log('SYNC_CRON_DISABLED:', process.env.SYNC_CRON_DISABLED ?? '(no definido)');
console.log('LEGACY_SYNC_CRON_CHILD:', process.env.LEGACY_SYNC_CRON_CHILD ?? '(no definido)');
console.log('LEGACY_DB_TYPE:', process.env.LEGACY_DB_TYPE || '(no definido → mock)');
console.log('TZ (proceso):', TZ);
console.log('Hora sistema (ISO):', now.toISOString());
console.log(
  'Hora Argentina:',
  now.toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'long' })
);
console.log('\nExpresión cron:', JSON.stringify(expr));
console.log('cron.validate:', cron.validate(expr));

if (cron.validate(expr)) {
  const task = cron.schedule(expr, () => {}, { timezone: TZ });
  const next = task.getNextRun();
  task.stop();
  console.log('Próxima ejecución (UTC):', next ? next.toISOString() : '(null)');
  if (next) {
    console.log(
      'Próxima ejecución (Argentina):',
      next.toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'long' })
    );
  }
} else {
  console.log('\n❌ Expresión inválida. Formato: minuto hora día mes díaSemana');
  console.log('   Ejemplo 14:00 Argentina: SYNC_CRON_DATOS=0 14 * * *');
}

if (process.env.SYNC_CRON_DISABLED === '1') {
  console.log(
    '\n⚠️ SYNC_CRON_DISABLED=1: este proceso NO ejecutará el cron. Debe existir gestionstock-cron en PM2 o correr npm run cron:legacy.'
  );
}

console.log('\n--- Recomendaciones ---');
console.log('1. SYNC_CRON_* y TZ deben estar en .env.local en el VPS (mismo archivo que usa la app).');
console.log('2. PM2: usar ecosystem.config.cjs (scripts/pm2-start-web.cjs arranca Next + cron hijo).');
console.log('3. Tras cambiar .env.local: pm2 delete gestionstock && pm2 start ecosystem.config.cjs (o pm2 reload ecosystem.config.cjs --update-env).');
console.log('4. Si SYNC_CRON_DISABLED=1 en .env.local sin proceso gestionstock-cron, el cron NUNCA corre.');
console.log('5. La hora del VPS no importa si TZ=America/Argentina/Buenos_Aires (00 14 * * * = 14:00 Argentina).');
console.log('6. Probar sync manual: npm run sync:now');
console.log('7. Logs: pm2 logs gestionstock --lines 120 (buscar "Cron legacy activo" / "Próxima ejecución")');
