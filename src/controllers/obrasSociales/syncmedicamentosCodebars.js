require('dotenv').config();

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

const BATCH_SIZE = parseInt(
  process.env.BATCH_SIZE_MEDICAMENTOS_CODEBARS || '1000',
  10
);

let syncMedicamentosCodebarsState = {
  entity: 'medicamentos_codebars',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  updated: 0,
  conCodebar2: 0,
  conCodebar3: 0,
  conCodebar4: 0,
  startedAt: null,
  batchNumber: 0,
  lastResult: null,
};

function normalizeCodebar(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

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

  if (syncMedicamentosCodebarsState.inProgress) {
    console.log('⏸️ Sync medicamentos codebars ya en progreso');
    return {
      processed: syncMedicamentosCodebarsState.processed,
      total: syncMedicamentosCodebarsState.total,
      updated: syncMedicamentosCodebarsState.updated,
      conCodebar2: syncMedicamentosCodebarsState.conCodebar2,
      conCodebar3: syncMedicamentosCodebarsState.conCodebar3,
      conCodebar4: syncMedicamentosCodebarsState.conCodebar4,
    };
  }

  syncMedicamentosCodebarsState.inProgress = true;
  syncMedicamentosCodebarsState.completed = false;
  syncMedicamentosCodebarsState.total = 0;
  syncMedicamentosCodebarsState.processed = 0;
  syncMedicamentosCodebarsState.updated = 0;
  syncMedicamentosCodebarsState.conCodebar2 = 0;
  syncMedicamentosCodebarsState.conCodebar3 = 0;
  syncMedicamentosCodebarsState.conCodebar4 = 0;
  syncMedicamentosCodebarsState.startedAt = new Date();
  syncMedicamentosCodebarsState.batchNumber = 0;
  syncMedicamentosCodebarsState.lastResult = null;

  try {
    const startTime = Date.now();

    const { count, error: countError } = await supabase
      .from('medicamentos')
      .select('codplex', { count: 'exact', head: true });

    if (countError) {
      throw countError;
    }

    syncMedicamentosCodebarsState.total = count || 0;

    let from = 0;
    let batchNumber = 0;

    while (from < syncMedicamentosCodebarsState.total) {
      batchNumber += 1;
      syncMedicamentosCodebarsState.batchNumber = batchNumber;

      const to = Math.min(from + BATCH_SIZE - 1, syncMedicamentosCodebarsState.total - 1);

      const { data: medicamentos, error: medsError } = await supabase
        .from('medicamentos')
        .select('codplex, cod_rubro, codebar, codebar2, codebar3, codebar4')
        .order('codplex', { ascending: true })
        .range(from, to);

      if (medsError) {
        throw medsError;
      }

      if (!medicamentos || medicamentos.length === 0) {
        break;
      }

      const codplexes = medicamentos
        .map(med => Number(med.codplex))
        .filter(codplex => Number.isFinite(codplex));

      const groupedCodebars = new Map();

      if (codplexes.length > 0) {
        const { data: codes, error: codesError } = await supabase
          .from('productoscodebars')
          .select('idproducto, codebar')
          .in('idproducto', codplexes)
          .order('idproducto', { ascending: true })
          .order('codebar', { ascending: true });

        if (codesError) {
          throw codesError;
        }

        for (const row of codes || []) {
          const idproducto = Number(row.idproducto);
          const codebar = normalizeCodebar(row.codebar);

          if (!Number.isFinite(idproducto) || !codebar) continue;

          if (!groupedCodebars.has(idproducto)) {
            groupedCodebars.set(idproducto, []);
          }

          groupedCodebars.get(idproducto).push(codebar);
        }
      }

      const updates = [];
      let conCodebar2EnLote = 0;
      let conCodebar3EnLote = 0;
      let conCodebar4EnLote = 0;

      for (const med of medicamentos) {
        const codplex = Number(med.codplex);
        const principal = normalizeCodebar(med.codebar);
        const secundarios = [];
        const usados = new Set();

        if (principal) {
          usados.add(principal);
        }

        for (const codebar of groupedCodebars.get(codplex) || []) {
          if (usados.has(codebar)) continue;
          usados.add(codebar);
          secundarios.push(codebar);
          if (secundarios.length === 3) break;
        }

        const [cb2, cb3, cb4] = [
          secundarios[0] || null,
          secundarios[1] || null,
          secundarios[2] || null,
        ];

        if (cb2) conCodebar2EnLote += 1;
        if (cb3) conCodebar3EnLote += 1;
        if (cb4) conCodebar4EnLote += 1;

        if (
          normalizeCodebar(med.codebar2) === cb2 &&
          normalizeCodebar(med.codebar3) === cb3 &&
          normalizeCodebar(med.codebar4) === cb4
        ) {
          continue;
        }

        updates.push({
          codplex,
          cod_rubro: med.cod_rubro,
          codebar2: cb2,
          codebar3: cb3,
          codebar4: cb4,
        });
      }

      syncMedicamentosCodebarsState.conCodebar2 += conCodebar2EnLote;
      syncMedicamentosCodebarsState.conCodebar3 += conCodebar3EnLote;
      syncMedicamentosCodebarsState.conCodebar4 += conCodebar4EnLote;
      syncMedicamentosCodebarsState.processed += medicamentos.length;

      if (updates.length > 0) {
        const { error: updateError } = await supabase
          .from('medicamentos')
          .upsert(updates, { onConflict: 'codplex' });

        if (updateError) {
          throw updateError;
        }

        syncMedicamentosCodebarsState.updated += updates.length;
      }

      console.log(
        `✅ Lote medicamentos codebars #${batchNumber} confirmado — procesados: ${syncMedicamentosCodebarsState.processed}/${syncMedicamentosCodebarsState.total}, actualizados: ${syncMedicamentosCodebarsState.updated}`
      );

      from += medicamentos.length;
    }

    syncMedicamentosCodebarsState.completed = true;

    const result = {
      processed: syncMedicamentosCodebarsState.processed,
      total: syncMedicamentosCodebarsState.total,
      updated: syncMedicamentosCodebarsState.updated,
      conCodebar2: syncMedicamentosCodebarsState.conCodebar2,
      conCodebar3: syncMedicamentosCodebarsState.conCodebar3,
      conCodebar4: syncMedicamentosCodebarsState.conCodebar4,
      duration: ((Date.now() - startTime) / 1000).toFixed(1),
    };
    syncMedicamentosCodebarsState.lastResult = result;

    console.log(
      `🏁 Sync medicamentos codebars finalizado — procesados: ${result.processed}/${result.total}, actualizados: ${result.updated}, con codebar2: ${result.conCodebar2}, con codebar3: ${result.conCodebar3}, con codebar4: ${result.conCodebar4}, duración: ${result.duration}s`
    );

    return result;
  } finally {
    syncMedicamentosCodebarsState.inProgress = false;
  }
}

module.exports = {
  syncMedicamentosCodebars,
  syncMedicamentosCodebarsState,
};

