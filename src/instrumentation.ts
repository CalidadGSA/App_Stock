/**
 * Arranque del servidor Next (dev, start, PM2): lanza el cron legacy en un
 * subproceso Node para no empaquetar mysql2/dotenv con el bundler.
 *
 * En PM2 también podés usar un proceso aparte: `npm run cron:legacy`
 * (ver ecosystem.config.cjs) y poner SYNC_CRON_DISABLED=1 en la app Next.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (process.env.SYNC_CRON_DISABLED !== '1') {
    try {
      const { startLegacySyncCronChild } = await import('./instrumentation/register-legacy-sync-cron');
      startLegacySyncCronChild();
    } catch (err) {
      console.error('❌ Cron sync legacy: falló el arranque desde instrumentation', err);
    }
  } else {
    console.log('⏭️ Cron sync legacy deshabilitado (SYNC_CRON_DISABLED=1)');
  }

  try {
    const { startInventarioCierreCron } = await import('./instrumentation/register-inventario-cierre-cron');
    startInventarioCierreCron();
  } catch (err) {
    console.error('❌ Cron cierre inventarios: falló el registro desde instrumentation', err);
  }
}
