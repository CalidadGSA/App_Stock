/**
 * Carga el warmup Onze con ruta absoluta en runtime (sin importar mysql2 en el bundle).
 */
export function startOnzePoolWarmup(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require('module') as typeof import('module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pathToFileURL } = require('url') as typeof import('url');

  const projectRoot = process.cwd();
  const starterPath = path.join(projectRoot, 'scripts', 'warmup-onze-pool.cjs');
  const nodeRequire = createRequire(pathToFileURL(path.join(projectRoot, 'package.json')).href);

  try {
    nodeRequire(starterPath);
  } catch (err) {
    console.warn('[warmup] No se pudo iniciar warmup Onze:', err);
  }
}
