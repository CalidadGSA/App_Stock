/**
 * Arranque PM2 recomendado: carga .env.local, inicia el cron legacy en un hijo
 * y luego Next.js (un solo proceso PM2, sin depender de instrumentation).
 */
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.join(__dirname, '..');
process.chdir(appDir);

require(path.join(appDir, 'src', 'load-env'));

let cronChildPid = null;
if (process.env.SYNC_CRON_DISABLED === '1') {
  console.log('⏭️ Cron legacy no se inicia (SYNC_CRON_DISABLED=1). Usá gestionstock-cron en PM2.');
} else {
  const cronStarter = require('./start-legacy-sync-cron.cjs');
  cronChildPid = cronStarter.pid ?? null;
  if (cronStarter.started && cronChildPid) {
    console.log(`✅ Cron legacy activo en proceso hijo PID ${cronChildPid}`);
  } else if (cronStarter.error) {
    console.error(`❌ Cron legacy no arrancó: ${cronStarter.error}`);
  }
}

const port = process.env.PORT || '3000';
const nextBin = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');

console.log(`🌐 Iniciando Next.js en puerto ${port}…`);

// El cron ya corre en el proceso PM2 padre; evitar un segundo fork vía instrumentation de Next.
const nextEnv = { ...process.env, SYNC_CRON_DISABLED: '1' };

const next = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
  cwd: appDir,
  env: nextEnv,
  stdio: 'inherit',
});

next.on('error', (err) => {
  console.error('❌ No se pudo iniciar Next.js:', err);
  process.exit(1);
});

next.on('exit', (code, signal) => {
  if (signal) {
    console.log(`Next.js terminó (signal=${signal})`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

function shutdown(signal) {
  if (!next.killed) next.kill(signal);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
