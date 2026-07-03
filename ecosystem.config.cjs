/**
 * PM2 en VPS
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Variables: solo .env.local en la raíz (como en desarrollo).
 * Diagnóstico: npm run cron:diagnose
 * Sync manual:  npm run sync:now
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const appDir = __dirname;

function readEnvFile(filename) {
  const filePath = path.join(appDir, filename);
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

/** .env.local es la fuente principal (no hace falta .env). */
const envFromFiles = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
};

const sharedEnv = {
  NODE_ENV: 'production',
  TZ: 'America/Argentina/Buenos_Aires',
  ...envFromFiles,
};

module.exports = {
  apps: [
    {
      name: 'gestionstock',
      cwd: appDir,
      script: 'scripts/pm2-start-web.cjs',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        ...sharedEnv,
      },
    },
    /*
    // Opcional: cron en proceso aparte (si preferís no usar el hijo de pm2-start-web.cjs)
    {
      name: 'gestionstock-cron',
      cwd: appDir,
      script: 'src/jobs/obrasSocialesSync.runner.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        ...sharedEnv,
        SYNC_CRON_DISABLED: '1',
      },
    },
    */
  ],
};
