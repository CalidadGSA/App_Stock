require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_SUBRUBROS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC subrubros
====================================================== */
let syncSubrubrosState = {
  entity: 'subrubros',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza subrubros desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según IDSubRubro
 */
async function syncSubrubrosLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncSubrubrosLegacyToSupabase llamado con dbType !== mysql, se omite.');
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

  if (syncSubrubrosState.inProgress) {
    console.log('⏸️ Sync subrubros ya en progreso');
    return {
      processed: syncSubrubrosState.processed,
      total: syncSubrubrosState.total,
    };
  }

  syncSubrubrosState.entity = 'subrubros';
  syncSubrubrosState.inProgress = true;
  syncSubrubrosState.completed = false;
  syncSubrubrosState.total = 0;
  syncSubrubrosState.processed = 0;
  syncSubrubrosState.startedAt = new Date();
  syncSubrubrosState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync subrubros → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'subrubros', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'subrubros',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización subrubros',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM subrubros'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncSubrubrosState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncSubrubrosState.total = totalExterno;
    } else {
      syncSubrubrosState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastIdSubRubro = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(IDSubRubro) AS min_id
          FROM (
            SELECT IDSubRubro
            FROM subrubros
            ORDER BY IDSubRubro DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastIdSubRubro = Number(minId) - 1;
      } else {
        lastIdSubRubro = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncSubrubrosState.processed >= syncSubrubrosState.total
      ) {
        break;
      }

      batchNumber++;
      syncSubrubrosState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            IDSubRubro AS idsubrubro,
            Nombre     AS nombre,
            IDRubro    AS idrubro,
            IDCategoria AS idcategoria
          FROM subrubros
          WHERE IDSubRubro > ?
          ORDER BY IDSubRubro
          LIMIT ?
        `,
        [lastIdSubRubro, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote subrubros #${batchNumber} → ${rows.length} registros (desde IDSubRubro > ${lastIdSubRubro})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastIdSubRubroInBatch = lastIdSubRubro;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncSubrubrosState.processed + processedInBatch >=
              syncSubrubrosState.total
          ) {
            break;
          }

          batchToInsert.push({
            idsubrubro: r.idsubrubro,
            nombre: r.nombre,
            idrubro: r.idrubro,
            idcategoria: r.idcategoria,
          });

          processedInBatch++;
          lastIdSubRubroInBatch = r.idsubrubro;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('subrubros')
          .upsert(batchToInsert, { onConflict: 'idsubrubro' });

        if (upsertError) {
          throw upsertError;
        }

        lastIdSubRubro = lastIdSubRubroInBatch;
        syncSubrubrosState.processed += processedInBatch;

        console.log(
          `✅ Lote subrubros #${batchNumber} confirmado — procesados: ${syncSubrubrosState.processed}/${syncSubrubrosState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote subrubros:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'subrubros', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncSubrubrosState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'subrubros',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync subrubros completado — ${syncSubrubrosState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync subrubros FINALIZADO → ${syncSubrubrosState.processed} registros en ${duration}s`
    );

    return {
      processed: syncSubrubrosState.processed,
      total: syncSubrubrosState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync subrubros:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'subrubros', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'subrubros',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncSubrubrosState.inProgress = false;
  }
}

module.exports = { syncSubrubrosLegacyToSupabase, syncSubrubrosState };

