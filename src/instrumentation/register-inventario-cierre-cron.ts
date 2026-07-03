/**
 * Carga el starter .cjs con ruta absoluta en runtime (sin importar node-cron en el bundle).
 */
export function startInventarioCierreCron(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require('module') as typeof import('module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pathToFileURL } = require('url') as typeof import('url');

  const projectRoot = process.cwd();
  const starterPath = path.join(projectRoot, 'scripts', 'start-inventario-cierre-cron.cjs');
  const nodeRequire = createRequire(pathToFileURL(path.join(projectRoot, 'package.json')).href);

  try {
    nodeRequire(starterPath);
    console.log(`✅ Cron cierre inventarios: registrado (${starterPath})`);
  } catch (err) {
    console.error(`❌ Cron cierre inventarios: no se pudo cargar ${starterPath}`, err);
    throw err;
  }
}
