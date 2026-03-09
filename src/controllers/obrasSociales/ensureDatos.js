/**
 * Verifica conexión a Supabase y que existan tablas de sync de datos (sync_status, audit_log).
 * Las tablas deben estar creadas en Supabase (schema.sql). Aquí solo comprobamos que respondan.
 * Si faltan env vars, solo se advierte y no se tira error para no bloquear el arranque del servidor.
 */
async function ensureDatos() {
  try {
    const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
    const supabase = getSupabaseAdmin();

    const { error: errStatus } = await supabase.from('sync_status').select('key').limit(1);
    if (errStatus) {
      console.warn('⚠️ sync_status no accesible (¿ejecutaste el schema en Supabase?):', errStatus.message);
    }

    const { error: errAudit } = await supabase.from('audit_log').select('id').limit(1);
    if (errAudit) {
      console.warn('⚠️ audit_log no accesible:', errAudit.message);
    }

    if (!errStatus && !errAudit) {
      console.log('📦 Sync datos: Conexión Supabase OK — tablas sync_status y audit_log disponibles');
    }
  } catch (e) {
    console.warn('⚠️ Supabase no configurado o no accesible:', e.message);
  }
}

module.exports = { ensureDatos };
