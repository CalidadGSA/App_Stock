require('dotenv').config();

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

/**
 * Rellena codebar2, codebar3 y codebar4 en la tabla medicamentos
 * usando los datos de productoscodebars (ya sincronizados desde Quantio).
 *
 * Regla:
 *  - Se toman todos los codebars de productoscodebars.idproducto = medicamentos.codplex
 *  - Se descarta el codebar principal (medicamentos.codebar)
 *  - Se asignan hasta 3 adicionales en codebar2, codebar3 y codebar4
 */
async function syncMedicamentosCodebars() {
  const supabase = getSupabaseAdmin();

  // Traer todos los medicamentos con su codebar actual
  const { data: medicamentos, error: medsError } = await supabase
    .from('medicamentos')
    .select('codplex, codebar, codebar2, codebar3, codebar4');

  if (medsError) {
    throw medsError;
  }

  let processed = 0;

  for (const med of medicamentos || []) {
    const codplex = med.codplex;

    const { data: codes, error: codesError } = await supabase
      .from('productoscodebars')
      .select('codebar')
      .eq('idproducto', codplex);

    if (codesError) {
      // eslint-disable-next-line no-console
      console.error(
        '[syncMedicamentosCodebars] Error leyendo productoscodebars para',
        codplex,
        codesError.message
      );
      continue;
    }

    if (!codes || codes.length === 0) continue;

    const principal = med.codebar || null;

    const adicionales = codes
      .map(c => c.codebar)
      .filter(cb => cb && cb !== principal);

    if (adicionales.length === 0) continue;

    const [cb2, cb3, cb4] = adicionales;

    // Evitar updates innecesarios si ya están igual
    if (
      med.codebar2 === cb2 &&
      med.codebar3 === cb3 &&
      med.codebar4 === cb4
    ) {
      continue;
    }

    const { error: updateError } = await supabase
      .from('medicamentos')
      .update({
        codebar2: cb2 ?? null,
        codebar3: cb3 ?? null,
        codebar4: cb4 ?? null,
      })
      .eq('codplex', codplex);

    if (updateError) {
      // eslint-disable-next-line no-console
      console.error(
        '[syncMedicamentosCodebars] Error actualizando medicamento',
        codplex,
        updateError.message
      );
      continue;
    }

    processed += 1;
  }

  return { processed, total: medicamentos ? medicamentos.length : 0 };
}

module.exports = {
  syncMedicamentosCodebars,
};

