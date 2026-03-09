require('dotenv').config();
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

/* ======================================================
   ⚙️ CONFIG
====================================================== */
const SYNC_CRON_DATOS =
  process.env.SYNC_CRON_DATOS ||
  process.env.SYNC_CRON_SUCURSALES ||
  process.env.SYNC_CRON_sucursales ||
  '45 3 * * *';

const TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

console.log(`🕒 Cron sync datos (sucursales + operadores) activo: ${SYNC_CRON_DATOS}`);

/* ======================================================
   ⏰ CRON
====================================================== */
cron.schedule(
  SYNC_CRON_DATOS,
  async () => {
    console.log(
      '\n⏰ Cron → Sync sucursales + operadores + medicamentos (legacy → interna)',
      new Date().toLocaleString('es-AR', { timeZone: TZ })
    );

    try {
      await syncLegacyToSupabase({ mode: 'ALL' });
      await syncOperadoresLegacyToSupabase({ mode: 'ALL' });
      await syncMedicamentosLegacyToSupabase({ mode: 'ALL' });
      await syncRubrosLegacyToSupabase({ mode: 'ALL' });
      await syncSubrubrosLegacyToSupabase({ mode: 'ALL' });
      await syncCategoriasLegacyToSupabase({ mode: 'ALL' });
      await syncPsicofarmacosLegacyToSupabase({ mode: 'ALL' });
    } catch (e) {
      console.error(
        '❌ Error cron sync datos (sucursales/operadores/medicamentos/rubros/subrubros/categorias/psicofarmacos):',
        e
      );
    }
  },
  { timezone: TZ }
);