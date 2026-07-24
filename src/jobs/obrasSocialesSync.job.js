const cron = require('node-cron');
const { syncLegacyToSupabase } = require('../controllers/obrasSociales/syncdatos');
const {
  syncOperadoresLegacyToSupabase,
} = require('../controllers/obrasSociales/syncoperadores');
const {
  syncMedicamentosLegacyToSupabase,
} = require('../controllers/obrasSociales/syncmedicamentos');
const {
  syncRubrosLegacyToSupabase,
} = require('../controllers/obrasSociales/syncrubros');
const {
  syncSubrubrosLegacyToSupabase,
} = require('../controllers/obrasSociales/syncsubrubros');
const {
  syncCategoriasLegacyToSupabase,
} = require('../controllers/obrasSociales/synccategorias');
const {
  syncPsicofarmacosLegacyToSupabase,
} = require('../controllers/obrasSociales/syncpsicofarmacos');
const {
  syncUsuariosQuantioToSupabase,
} = require('../controllers/obrasSociales/syncusuariosquantio');
const {
  syncProductosQuantioToSupabase,
} = require('../controllers/obrasSociales/syncproductosquantio');
const {
  syncLaboratoriosLegacyToSupabase,
} = require('../controllers/obrasSociales/synclaboratorios');

const TZ = (process.env.TZ || 'America/Argentina/Buenos_Aires').trim();

function resolveCronExpression() {
  const raw =
    process.env.SYNC_CRON_DATOS ||
    process.env.SYNC_CRON_SUCURSALES ||
    process.env.SYNC_CRON_sucursales ||
    '45 3 * * *';
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

function formatNextRun(date) {
  if (!date) return '(desconocido)';
  return `${date.toISOString()} (${date.toLocaleString('es-AR', { timeZone: TZ })})`;
}

/** Evita cron duplicado al recargar módulos en dev (HMR / instrumentation). */
function shouldSkipDuplicateStart() {
  if (globalThis.__legacySyncCronStarted) {
    console.log('🕒 Cron sync legacy ya estaba registrado en este proceso');
    return true;
  }
  const inst = process.env.NODE_APP_INSTANCE;
  if (inst != null && inst !== '' && inst !== '0') {
    console.log(`⏭️ Cron sync legacy omitido en instancia PM2 ${inst}`);
    return true;
  }
  return false;
}

/**
 * Cada paso corre aislado: un fallo (p. ej. Quantio MySQL inalcanzable desde la
 * VPS) no aborta el resto del lote.
 */
async function runLegacySyncBatch() {
  console.log(
    '\n⏰ Sync legacy → Supabase (sucursales, operadores, medicamentos, catálogos, laboratorios, Quantio droguería)',
    new Date().toLocaleString('es-AR', { timeZone: TZ })
  );

  const pasos = [
    ['sucursales', () => syncLegacyToSupabase({ mode: 'ALL' })],
    ['operadores', () => syncOperadoresLegacyToSupabase({ mode: 'ALL' })],
    ['usuarios_quantio', () => syncUsuariosQuantioToSupabase()],
    ['productos_quantio', () => syncProductosQuantioToSupabase()],
    ['medicamentos', () => syncMedicamentosLegacyToSupabase({ mode: 'ALL' })],
    ['rubros', () => syncRubrosLegacyToSupabase({ mode: 'ALL' })],
    ['subrubros', () => syncSubrubrosLegacyToSupabase({ mode: 'ALL' })],
    ['categorias', () => syncCategoriasLegacyToSupabase({ mode: 'ALL' })],
    ['psicofarmacos', () => syncPsicofarmacosLegacyToSupabase({ mode: 'ALL' })],
    ['laboratorios', () => syncLaboratoriosLegacyToSupabase({ mode: 'ALL' })],
  ];

  const fallidos = [];
  for (const [nombre, run] of pasos) {
    try {
      await run();
    } catch (e) {
      fallidos.push(nombre);
      console.error(
        `❌ Sync "${nombre}" falló (se continúa con el resto):`,
        e instanceof Error ? e.message : e
      );
    }
  }

  if (fallidos.length) {
    console.warn(`⚠️ Lote sync legacy terminó con fallos en: ${fallidos.join(', ')}`);
  } else {
    console.log('✅ Lote sync legacy completo sin fallos');
  }
}

async function runOperadoresMedicamentosSyncBatch() {
  console.log(
    '\n⏰ Sync legacy → Supabase (solo operadores y medicamentos)',
    new Date().toLocaleString('es-AR', { timeZone: TZ })
  );

  await syncOperadoresLegacyToSupabase({ mode: 'ALL' });
  await syncMedicamentosLegacyToSupabase({ mode: 'ALL' });
}

function startLegacySyncCron() {
  if (shouldSkipDuplicateStart()) return null;

  const SYNC_CRON_DATOS = resolveCronExpression();

  if (!cron.validate(SYNC_CRON_DATOS)) {
    console.error(
      `❌ SYNC_CRON_* inválido: "${SYNC_CRON_DATOS}". Formato: minuto hora día mes díaSemana (ej. 0 14 * * * para las 14:00)`
    );
    return null;
  }

  globalThis.__legacySyncCronStarted = true;

  const now = new Date();
  const dbType = process.env.LEGACY_DB_TYPE || 'mock';

  console.log(
    `🕒 Cron sync legacy → Supabase: "${SYNC_CRON_DATOS}" (zona: ${TZ}) | ahora: ${now.toLocaleString('es-AR', { timeZone: TZ })} | PID ${process.pid}`
  );
  console.log(`   LEGACY_DB_TYPE=${dbType}`);
  if (dbType !== 'mysql') {
    console.warn(
      '⚠️ LEGACY_DB_TYPE no es "mysql": el cron se ejecutará pero no sincronizará datos reales (modo mock).'
    );
  }

  const task = cron.schedule(
    SYNC_CRON_DATOS,
    async () => {
      console.log(`⏰ Disparo programado del cron legacy (${new Date().toISOString()})`);
      try {
        await runLegacySyncBatch();
        console.log('✅ Cron sync legacy: lote finalizado');
      } catch (e) {
        console.error('❌ Error cron sync legacy:', e);
      }
    },
    { timezone: TZ, name: 'legacy-sync-batch' }
  );

  const nextRun = task.getNextRun();
  console.log(`   Próxima ejecución: ${formatNextRun(nextRun)}`);

  task.on('execution:missed', (ctx) => {
    console.warn(
      `⚠️ Cron legacy: ejecución perdida (reloj/CPU). Programada: ${ctx.dateTrigger?.toISOString?.() ?? ctx.dateTrigger}`
    );
  });

  const heartbeatMs = 6 * 60 * 60 * 1000;
  setInterval(() => {
    const next = task.getNextRun();
    console.log(
      `💓 Cron legacy activo | próxima: ${formatNextRun(next)} | ahora AR: ${new Date().toLocaleString('es-AR', { timeZone: TZ })}`
    );
  }, heartbeatMs).unref();

  if (process.env.SYNC_RUN_ON_START === '1') {
    console.log('▶️ SYNC_RUN_ON_START=1 → ejecutando sync ahora…');
    runLegacySyncBatch().catch((e) => console.error('❌ Error sync al inicio:', e));
  }

  return task;
}

module.exports = {
  startLegacySyncCron,
  runLegacySyncBatch,
  runOperadoresMedicamentosSyncBatch,
  resolveCronExpression,
  TZ,
};
