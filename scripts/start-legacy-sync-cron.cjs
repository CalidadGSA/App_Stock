/**
 * Arranque del cron legacy vía subproceso Node (fuera del bundle de Next/Turbopack).
 */
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

let shuttingDown = false;
let restartTimer = null;

const script = path.join(__dirname, '..', 'src', 'jobs', 'obrasSocialesSync.runner.js');
if (!fs.existsSync(script)) {
  console.error(`❌ Cron legacy: no existe el runner en ${script} (cwd=${process.cwd()})`);
  module.exports = { started: false, error: 'runner_not_found' };
  return;
}

function spawnCronChild() {
  const existing = global.__legacySyncCronChild;
  if (existing && existing.exitCode === null && !existing.killed) {
    console.log('🕒 Cron legacy: hijo ya en ejecución, no se duplica');
    return existing;
  }

  console.log(`🕒 Cron legacy: forkeando ${script}`);

  const child = fork(script, [], {
    env: { ...process.env, LEGACY_SYNC_CRON_CHILD: '1' },
    stdio: 'inherit',
  });

  global.__legacySyncCronChild = child;

  child.on('error', (err) => {
    console.error('❌ Cron legacy: error en proceso hijo', err);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0 && code !== null) {
      console.error(`❌ Proceso cron sync legacy terminó (code=${code}, signal=${signal})`);
      console.log('🔄 Reintentando arranque del cron legacy en 10 s…');
      restartTimer = setTimeout(() => {
        restartTimer = null;
        spawnCronChild();
      }, 10000);
    }
  });

  return child;
}

const child = spawnCronChild();

const shutdown = () => {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (child && !child.killed) child.kill('SIGTERM');
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { started: true, child, pid: child?.pid };
