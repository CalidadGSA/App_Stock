/**
 * Carga el starter .cjs con ruta absoluta en runtime.
 * Usa process.cwd() (PM2 cwd = raíz del repo), no import.meta.url: en producción
 * el bundle vive bajo .next/ y una ruta relativa al chunk falla en silencio.
 *
 * require() en runtime: compatible con Webpack (--webpack) y Turbopack.
 */
export function startLegacySyncCronChild(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require('module') as typeof import('module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pathToFileURL } = require('url') as typeof import('url');

  const projectRoot = process.cwd();
  const starterPath = path.join(projectRoot, 'scripts', 'start-legacy-sync-cron.cjs');
  const nodeRequire = createRequire(pathToFileURL(path.join(projectRoot, 'package.json')).href);

  try {
    nodeRequire(starterPath);
    console.log(`✅ Cron legacy: proceso hijo iniciado (${starterPath})`);
  } catch (err) {
    console.error(`❌ Cron legacy: no se pudo cargar ${starterPath}`, err);
    throw err;
  }
}
