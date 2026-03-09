require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_RUBROS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC rubros
====================================================== */
let syncRubrosState = {
  entity: 'rubros',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza rubros desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según CodRubro
 */
async function syncRubrosLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncRubrosLegacyToSupabase llamado con dbType !== mysql, se omite.');
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

  if (syncRubrosState.inProgress) {
    console.log('⏸️ Sync rubros ya en progreso');
    return {
      processed: syncRubrosState.processed,
      total: syncRubrosState.total,
    };
  }

  syncRubrosState.entity = 'rubros';
  syncRubrosState.inProgress = true;
  syncRubrosState.completed = false;
  syncRubrosState.total = 0;
  syncRubrosState.processed = 0;
  syncRubrosState.startedAt = new Date();
  syncRubrosState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync rubros → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'rubros', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'rubros',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización rubros',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM rubros'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncRubrosState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncRubrosState.total = totalExterno;
    } else {
      syncRubrosState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastCodRubro = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(CodRubro) AS min_id
          FROM (
            SELECT CodRubro
            FROM rubros
            ORDER BY CodRubro DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastCodRubro = Number(minId) - 1;
      } else {
        lastCodRubro = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncRubrosState.processed >= syncRubrosState.total
      ) {
        break;
      }

      batchNumber++;
      syncRubrosState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            CodRubro AS codrubro,
            Rubro    AS rubro
          FROM rubros
          WHERE CodRubro > ?
          ORDER BY CodRubro
          LIMIT ?
        `,
        [lastCodRubro, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote rubros #${batchNumber} → ${rows.length} registros (desde CodRubro > ${lastCodRubro})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastCodRubroInBatch = lastCodRubro;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncRubrosState.processed + processedInBatch >=
              syncRubrosState.total
          ) {
            break;
          }

          batchToInsert.push({
            codrubro: r.codrubro,
            rubro: r.rubro,
          });

          processedInBatch++;
          lastCodRubroInBatch = r.codrubro;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('rubros')
          .upsert(batchToInsert, { onConflict: 'codrubro' });

        if (upsertError) {
          throw upsertError;
        }

        lastCodRubro = lastCodRubroInBatch;
        syncRubrosState.processed += processedInBatch;

        console.log(
          `✅ Lote rubros #${batchNumber} confirmado — procesados: ${syncRubrosState.processed}/${syncRubrosState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote rubros:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'rubros', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncRubrosState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'rubros',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync rubros completado — ${syncRubrosState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync rubros FINALIZADO → ${syncRubrosState.processed} registros en ${duration}s`
    );

    return {
      processed: syncRubrosState.processed,
      total: syncRubrosState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync rubros:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'rubros', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'rubros',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncRubrosState.inProgress = false;
  }
}

module.exports = { syncRubrosLegacyToSupabase, syncRubrosState };

