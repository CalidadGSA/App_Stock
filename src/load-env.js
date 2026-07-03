/**
 * Carga variables para procesos Node fuera de Next (cron, PM2, scripts).
 * En este proyecto la configuración vive en .env.local (opcional .env encima).
 * Mismo criterio que Next.js: .env.local tiene prioridad sobre .env.
 */
const path = require('path');
const dotenv = require('dotenv');

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });
