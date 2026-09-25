/**
 * Diagnóstico del cron de cierre de inventarios + snapshot KPIs.
 *   npm run inventario:cierre:diagnose
 * Muestra la expresión, la próxima ejecución y cómo debería estar corriendo.
 * Para ejecutarlo YA: npm run inventario:cierre
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

require('../src/load-env');

const root = path.join(__dirname, '..');
const TZ = (process.env.TZ || 'America/Argentina/Buenos_Aires').trim();
const expr = String(process.env.INVENTARIO_CIERRE_CRON || '0 0 * * *')
  .trim()
  .replace(/^['"]|['"]$/g, '');
const now = new Date();

console.log('=== Diagnóstico cron cierre inventarios / snapshot KPIs ===\n');
console.log('Raíz proyecto:', root);
console.log('.env.local existe:', fs.existsSync(path.join(root, '.env.local')));
console.log(
  'INVENTARIO_CIERRE_CRON:',
  process.env.INVENTARIO_CIERRE_CRON ?? `(no definido → "${expr}" = 00:00 todos los días)`
);
console.log('INVENTARIO_CIERRE_CRON_DISABLED:', process.env.INVENTARIO_CIERRE_CRON_DISABLED ?? '(no definido)');
console.log('INVENTARIO_CIERRE_HORAS:', process.env.INVENTARIO_CIERRE_HORAS ?? '(no definido → 168)');
console.log('TZ:', TZ);
console.log(
  'Hora Argentina:',
  now.toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'long' })
);
console.log(
  'Supabase configurado:',
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
);
console.log(
  'Onze configurado (snapshot stock):',
  Boolean(process.env.ONZE_DB_HOST && process.env.ONZE_DB_USER && process.env.ONZE_DB_NAME)
);

let tsxOk = false;
try {
  require.resolve('tsx', { paths: [root] });
  tsxOk = true;
} catch {
  tsxOk = false;
}
console.log('tsx instalado (necesario para el job):', tsxOk);

console.log('\ncron.validate:', cron.validate(expr));
if (cron.validate(expr)) {
  const task = cron.schedule(expr, () => {}, { timezone: TZ });
  const next = task.getNextRun();
  task.stop();
  if (next) {
    console.log(
      'Próxima ejecución (Argentina):',
      next.toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'long' })
    );
  }
} else {
  console.log('❌ Expresión inválida. Formato: minuto hora día mes díaSemana (ej. "0 0 * * *").');
}

console.log('\n--- Cómo corre ---');
console.log('El cron NO es una tarea del sistema: vive dentro del proceso de la app (node-cron).');
console.log('1. PM2 (VPS): pm2 start ecosystem.config.cjs → scripts/pm2-start-web.cjs lo registra al arrancar.');
console.log('   Verificar: pm2 logs gestionstock --lines 200 | grep -i "cron cierre"');
console.log(`   Debe aparecer: Cron cierre inventarios: "${expr}" (zona: ${TZ}) y "Próximo cierre automático".`);
console.log('2. Sin PM2 (npm run start / npm run dev): lo registra instrumentation.ts al levantar Next.');
console.log('3. Si la app no queda corriendo 24/7, programalo en el sistema operativo llamando a:');
console.log('   npm run inventario:cierre        (ejecuta cierre + snapshot una vez y termina)');
console.log(`   - Linux:   crontab -e → 0 0 * * * cd ${root} && npm run inventario:cierre >> logs/cierre.log 2>&1`);
console.log('   - Windows: scripts/registrar-tarea-cierre-windows.ps1 (Programador de tareas).');
console.log('\nPara forzar una corrida ahora: npm run inventario:cierre');
