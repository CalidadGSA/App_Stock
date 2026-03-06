require('dotenv').config();
const cron = require('node-cron');
const { syncLegacyToSupabase } = require('../controllers/obrasSociales/syncdatos');

/* ======================================================
   ⚙️ CONFIG
====================================================== */
const SYNC_CRON_DATOS =
  process.env.SYNC_CRON_DATOS || process.env.SYNC_CRON_sucursales || '45 3 * * *';

const TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

console.log(`🕒 Cron sync datos activo: ${SYNC_CRON_DATOS}`);

/* ======================================================
   ⏰ CRON
====================================================== */
cron.schedule(
  SYNC_CRON_DATOS,
  async () => {
    console.log(
      '\n⏰ Cron → Sync datos (legacy → Supabase)',
      new Date().toLocaleString('es-AR', { timeZone: TZ })
    );

    try {
      await syncLegacyToSupabase({ mode: 'ALL' });
    } catch (e) {
      console.error('❌ Error cron sync datos:', e);
    }
  },
  { timezone: TZ }
);