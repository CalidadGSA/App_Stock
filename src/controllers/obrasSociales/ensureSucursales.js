const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

async function ensureSyncInfra() {
  const supabase = getSupabaseAdmin();

  // Tablas que forman parte de la infraestructura de sync legacy → Supabase
  const tablas = [
    'sucursales',
    'operadores',
    'medicamentos',
    'rubros',
    'subrubros',
    'categorias',
    'psicofarmacos',
    'sync_status',
    'audit_log',
  ];

  for (const table of tablas) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`❌ Error verificando tabla ${table} en Supabase:`, error);
      throw error;
    }
  }

  // Registro de auditoría general de infraestructura de sync
  const { error: auditError } = await supabase.from('audit_log').insert({
    entity: 'sync_infra',
    action: 'ensure',
    status: 'SUCCESS',
    message:
      'Verificación inicial de tablas de sync (sucursales, operadores, medicamentos, rubros, subrubros, categorias, psicofarmacos, sync_status, audit_log)',
  });

  if (auditError) {
    console.error('❌ Error escribiendo en audit_log en Supabase:', auditError);
    throw auditError;
  }

  console.log(
    '📦 Supabase OK: infraestructura de sync (sucursales/operadores/medicamentos/rubros/subrubros/categorias/psicofarmacos/sync_status/audit_log) accesible'
  );
}

// Alias para mantener la firma usada en main.js (ensureDatos)
module.exports = {
  ensureSyncInfra,
  ensureDatos: ensureSyncInfra,
};