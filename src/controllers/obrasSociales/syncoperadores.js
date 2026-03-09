require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_OPERADORES || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC operadores
====================================================== */
let syncOperadoresState = {
  entity: 'operadores',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza operadores desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según IDOperador
 */
async function syncOperadoresLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncOperadoresLegacyToSupabase llamado con dbType !== mysql, se omite.');
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

  if (syncOperadoresState.inProgress) {
    console.log('⏸️ Sync operadores ya en progreso');
    return {
      processed: syncOperadoresState.processed,
      total: syncOperadoresState.total,
    };
  }

  syncOperadoresState.entity = 'operadores';
  syncOperadoresState.inProgress = true;
  syncOperadoresState.completed = false;
  syncOperadoresState.total = 0;
  syncOperadoresState.processed = 0;
  syncOperadoresState.startedAt = new Date();
  syncOperadoresState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync operadores → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'operadores', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'operadores',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización operadores',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM operadores'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncOperadoresState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncOperadoresState.total = totalExterno;
    } else {
      syncOperadoresState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastIdOperador = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(IDOperador) AS min_id
          FROM (
            SELECT IDOperador
            FROM operadores
            ORDER BY IDOperador DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastIdOperador = Number(minId) - 1;
      } else {
        lastIdOperador = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncOperadoresState.processed >= syncOperadoresState.total
      ) {
        break;
      }

      batchNumber++;
      syncOperadoresState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            IDOperador     AS idoperador,
            Operador       AS operador,
            NombreCompleto AS nombrecompleto,
            Codigo         AS codigo,
            Activo         AS activo
          FROM operadores
          WHERE IDOperador > ?
          ORDER BY IDOperador
          LIMIT ?
        `,
        [lastIdOperador, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote operadores #${batchNumber} → ${rows.length} registros (desde IDOperador > ${lastIdOperador})`
        );

        const batchToInsert = [];
        const seenOperadores = new Set();
        let processedInBatch = 0;
        let lastIdOperadorInBatch = lastIdOperador;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncOperadoresState.processed + processedInBatch >=
              syncOperadoresState.total
          ) {
            break;
          }

          // Evitar duplicados por nombre de operador (constraint unique en Supabase)
          if (seenOperadores.has(r.operador)) {
            continue;
          }
          seenOperadores.add(r.operador);

          batchToInsert.push({
            idoperador: r.idoperador,
            operador: r.operador,
            nombrecompleto: r.nombrecompleto,
            codigo: r.codigo,
            activo: r.activo,
          });

          processedInBatch++;
          lastIdOperadorInBatch = r.idoperador;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('operadores')
          // Usamos la PK (idoperador) como clave de conflicto
          .upsert(batchToInsert, { onConflict: 'idoperador' });

        if (upsertError) {
          throw upsertError;
        }

        lastIdOperador = lastIdOperadorInBatch;
        syncOperadoresState.processed += processedInBatch;

        console.log(
          `✅ Lote operadores #${batchNumber} confirmado — procesados: ${syncOperadoresState.processed}/${syncOperadoresState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote operadores:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'operadores', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncOperadoresState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'operadores',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync operadores completado — ${syncOperadoresState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync operadores FINALIZADO → ${syncOperadoresState.processed} registros en ${duration}s`
    );

    return {
      processed: syncOperadoresState.processed,
      total: syncOperadoresState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync operadores:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'operadores', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'operadores',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncOperadoresState.inProgress = false;
  }
}

module.exports = { syncOperadoresLegacyToSupabase, syncOperadoresState };

