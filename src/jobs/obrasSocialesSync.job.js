require('dotenv').config();
const cron = require('node-cron');
const { syncObrasSociales } = require('../controllers/obrasSociales/syncobrasSociales');

/* ======================================================
   ⚙️ CONFIG
====================================================== */
const SYNC_CRON_OBSOCIALES =
  process.env.SYNC_CRON_OBSOCIALES || '45 3 * * *';

const TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

console.log(`🕒 Cron obrasSociales activo: ${SYNC_CRON_OBSOCIALES}`);

/* ======================================================
   ⏰ CRON
====================================================== */
cron.schedule(
  SYNC_CRON_OBSOCIALES,
  async () => {
    console.log(
      '\n⏰ Cron → Sync obrasSociales',
      new Date().toLocaleString('es-AR', { timeZone: TZ })
    );

    try {
      // Tarea programada: sync completo (todos los registros), sin límite
      await syncObrasSociales({ mode: 'ALL' });
    } catch (e) {
      console.error('❌ Error cron obrasSociales:', e);
    }
  },
  { timezone: TZ }
);