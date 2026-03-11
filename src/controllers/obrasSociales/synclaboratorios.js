require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_LABORATORIOS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC laboratorios
====================================================== */
let syncLaboratoriosState = {
  entity: 'laboratorios',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza laboratorios desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según CodLab
 */
async function syncLaboratoriosLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncLaboratoriosLegacyToSupabase llamado con dbType !== mysql, se omite.');
    return { processed: 0, total: 0, duration: 0 };
  }

  const supabase = getSupabaseAdmin();

  const requestedMode = (mode || process.env.SYNC_MODE || 'ALL').toUpperCase();
  let SYNC_MODE_LOCAL = requestedMode;
  const effectiveLimit =
    typeof limitParam === 'number' && limitParam > 0 ? limitParam : SYNC_LIMIT;

  if (requestedMode === 'LAST' && effectiveLimit <= 0) {
    console.warn(
      '⚠️ SYNC_MODE=LAST con effectiveLimit=0 → se usa ALL para no saltar registros'
    );
    SYNC_MODE_LOCAL = 'ALL';
  }

  if (syncLaboratoriosState.inProgress) {
    console.log('⏸️ Sync laboratorios ya en progreso');
    return {
      processed: syncLaboratoriosState.processed,
      total: syncLaboratoriosState.total,
    };
  }

  syncLaboratoriosState.entity = 'laboratorios';
  syncLaboratoriosState.inProgress = true;
  syncLaboratoriosState.completed = false;
  syncLaboratoriosState.total = 0;
  syncLaboratoriosState.processed = 0;
  syncLaboratoriosState.startedAt = new Date();
  syncLaboratoriosState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync laboratorios → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'laboratorios', completed: false }, { onConflict: 'key' });
      if (error) throw error;
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'laboratorios',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización laboratorios',
      });
      if (error) throw error;
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM laboratorios'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncLaboratoriosState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncLaboratoriosState.total = totalExterno;
    } else {
      syncLaboratoriosState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastCodLab = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(CodLab) AS min_id
          FROM (
            SELECT CodLab
            FROM laboratorios
            ORDER BY CodLab DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastCodLab = Number(minId) - 1;
      } else {
        lastCodLab = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncLaboratoriosState.processed >= syncLaboratoriosState.total
      ) {
        break;
      }

      batchNumber++;
      syncLaboratoriosState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            CodLab   AS codlab,
            Laborato AS laborato
          FROM laboratorios
          WHERE CodLab > ?
          ORDER BY CodLab
          LIMIT ?
        `,
        [lastCodLab, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote laboratorios #${batchNumber} → ${rows.length} registros (desde CodLab > ${lastCodLab})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastCodLabInBatch = lastCodLab;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncLaboratoriosState.processed + processedInBatch >=
              syncLaboratoriosState.total
          ) {
            break;
          }

          batchToInsert.push({
            codlab: r.codlab,
            laborato: r.laborato,
          });

          processedInBatch++;
          lastCodLabInBatch = r.codlab;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('laboratorios')
          .upsert(batchToInsert, { onConflict: 'codlab' });

        if (upsertError) {
          throw upsertError;
        }

        lastCodLab = lastCodLabInBatch;
        syncLaboratoriosState.processed += processedInBatch;

        console.log(
          `✅ Lote laboratorios #${batchNumber} confirmado — procesados: ${syncLaboratoriosState.processed}/${syncLaboratoriosState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote laboratorios:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'laboratorios', completed: true }, { onConflict: 'key' });
      if (error) throw error;
    }

    syncLaboratoriosState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'laboratorios',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync laboratorios completado — ${syncLaboratoriosState.processed} registros sincronizados`,
      });
      if (error) throw error;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync laboratorios FINALIZADO → ${syncLaboratoriosState.processed} registros en ${duration}s`
    );

    return {
      processed: syncLaboratoriosState.processed,
      total: syncLaboratoriosState.total,
      duration: Number(duration),
    };
  } catch (error) {
    console.error('💥 Error en sync laboratorios:', error);

    await getSupabaseAdmin()
      .from('audit_log')
      .insert({
        entity: 'laboratorios',
        action: 'sync',
        status: 'ERROR',
        message: error.message || String(error),
      });

    throw error;
  } finally {
    syncLaboratoriosState.inProgress = false;
  }
}

module.exports = {
  syncLaboratoriosLegacyToSupabase,
  syncLaboratoriosState,
};

