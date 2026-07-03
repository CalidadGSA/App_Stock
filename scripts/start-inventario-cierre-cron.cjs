/**
 * Cron de cierre de inventarios abiertos (fuera del bundle de Next/Webpack).
 */
require('../src/load-env');

const cron = require('node-cron');
const path = require('path');
const { spawn } = require('child_process');

const TZ = (process.env.TZ || 'America/Argentina/Buenos_Aires').trim();

if (global.__inventarioCierreCronStarted) {
  console.log('🕒 Cron cierre inventarios ya registrado en este proceso');
  module.exports = { started: true, duplicate: true };
  return;
}

if (process.env.INVENTARIO_CIERRE_CRON_DISABLED === '1') {
  console.log('⏭️ Cron cierre inventarios deshabilitado (INVENTARIO_CIERRE_CRON_DISABLED=1)');
  module.exports = { started: false };
  return;
}

function resolveCronExpression() {
  const raw = process.env.INVENTARIO_CIERRE_CRON || '0 0 * * *';
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

const expr = resolveCronExpression();
if (!cron.validate(expr)) {
  console.error(`❌ INVENTARIO_CIERRE_CRON inválido: "${expr}"`);
  module.exports = { started: false, error: 'invalid_cron' };
  return;
}

function runCierreJob() {
  const script = path.join(__dirname, 'run-inventario-cierre-once.cjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('error', (err) => {
    console.error('❌ Error al ejecutar cierre de inventarios:', err);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ Cierre inventarios terminó (code=${code}, signal=${signal})`);
    }
  });
}

global.__inventarioCierreCronStarted = true;
const horas = parseInt(process.env.INVENTARIO_CIERRE_HORAS || '168', 10);

console.log(
  `🕒 Cron cierre inventarios: "${expr}" (zona: ${TZ}) · > ${horas}h abiertos | PID ${process.pid}`
);

const task = cron.schedule(
  expr,
  () => {
    console.log(`⏰ Disparo cron cierre inventarios (${new Date().toISOString()})`);
    runCierreJob();
  },
  { timezone: TZ, name: 'inventario-cierre-vencido' }
);

const nextRun = typeof task.getNextRun === 'function' ? task.getNextRun() : null;
if (nextRun) {
  console.log(
    `   Próximo cierre automático: ${nextRun.toISOString()} (${nextRun.toLocaleString('es-AR', { timeZone: TZ })})`
  );
}

if (process.env.INVENTARIO_CIERRE_RUN_ON_START === '1') {
  runCierreJob();
}

module.exports = { started: true, task };
