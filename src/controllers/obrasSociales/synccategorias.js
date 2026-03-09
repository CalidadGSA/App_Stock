require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_CATEGORIAS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC categorias
====================================================== */
let syncCategoriasState = {
  entity: 'categorias',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza categorias desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según IDCategoria
 */
async function syncCategoriasLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn(
      '⚠️ syncCategoriasLegacyToSupabase llamado con dbType !== mysql, se omite.'
    );
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

  if (syncCategoriasState.inProgress) {
    console.log('⏸️ Sync categorias ya en progreso');
    return {
      processed: syncCategoriasState.processed,
      total: syncCategoriasState.total,
    };
  }

  syncCategoriasState.entity = 'categorias';
  syncCategoriasState.inProgress = true;
  syncCategoriasState.completed = false;
  syncCategoriasState.total = 0;
  syncCategoriasState.processed = 0;
  syncCategoriasState.startedAt = new Date();
  syncCategoriasState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync categorias → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'categorias', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'categorias',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización categorias',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM categorias'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncCategoriasState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncCategoriasState.total = totalExterno;
    } else {
      syncCategoriasState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastIdCategoria = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(IDCategoria) AS min_id
          FROM (
            SELECT IDCategoria
            FROM categorias
            ORDER BY IDCategoria DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastIdCategoria = Number(minId) - 1;
      } else {
        lastIdCategoria = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncCategoriasState.processed >= syncCategoriasState.total
      ) {
        break;
      }

      batchNumber++;
      syncCategoriasState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            IDCategoria AS idcategoria,
            Nombre      AS nombre
          FROM categorias
          WHERE IDCategoria > ?
          ORDER BY IDCategoria
          LIMIT ?
        `,
        [lastIdCategoria, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote categorias #${batchNumber} → ${rows.length} registros (desde IDCategoria > ${lastIdCategoria})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastIdCategoriaInBatch = lastIdCategoria;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncCategoriasState.processed + processedInBatch >=
              syncCategoriasState.total
          ) {
            break;
          }

          batchToInsert.push({
            idcategoria: r.idcategoria,
            nombre: r.nombre,
          });

          processedInBatch++;
          lastIdCategoriaInBatch = r.idcategoria;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('categorias')
          .upsert(batchToInsert, { onConflict: 'idcategoria' });

        if (upsertError) {
          throw upsertError;
        }

        lastIdCategoria = lastIdCategoriaInBatch;
        syncCategoriasState.processed += processedInBatch;

        console.log(
          `✅ Lote categorias #${batchNumber} confirmado — procesados: ${syncCategoriasState.processed}/${syncCategoriasState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote categorias:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'categorias', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncCategoriasState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'categorias',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync categorias completado — ${syncCategoriasState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync categorias FINALIZADO → ${syncCategoriasState.processed} registros en ${duration}s`
    );

    return {
      processed: syncCategoriasState.processed,
      total: syncCategoriasState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync categorias:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'categorias', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'categorias',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncCategoriasState.inProgress = false;
  }
}

module.exports = { syncCategoriasLegacyToSupabase, syncCategoriasState };

