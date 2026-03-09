require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_PSICOFARMACOS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC psicofarmacos
====================================================== */
let syncPsicofarmacosState = {
  entity: 'psicofarmacos',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza psicofarmacos desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según IDPsicofarmaco
 */
async function syncPsicofarmacosLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn(
      '⚠️ syncPsicofarmacosLegacyToSupabase llamado con dbType !== mysql, se omite.'
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

  if (syncPsicofarmacosState.inProgress) {
    console.log('⏸️ Sync psicofarmacos ya en progreso');
    return {
      processed: syncPsicofarmacosState.processed,
      total: syncPsicofarmacosState.total,
    };
  }

  syncPsicofarmacosState.entity = 'psicofarmacos';
  syncPsicofarmacosState.inProgress = true;
  syncPsicofarmacosState.completed = false;
  syncPsicofarmacosState.total = 0;
  syncPsicofarmacosState.processed = 0;
  syncPsicofarmacosState.startedAt = new Date();
  syncPsicofarmacosState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync psicofarmacos → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert(
          { key: 'psicofarmacos', completed: false },
          { onConflict: 'key' }
        );
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'psicofarmacos',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización psicofarmacos',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM psicofarmacos'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncPsicofarmacosState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncPsicofarmacosState.total = totalExterno;
    } else {
      syncPsicofarmacosState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastIdPsico = '';

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(IDPsicofarmaco) AS min_id
          FROM (
            SELECT IDPsicofarmaco
            FROM psicofarmacos
            ORDER BY IDPsicofarmaco DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        // Para cadenas, usamos comparación lexicográfica; no restamos 1.
        lastIdPsico = '';
      } else {
        lastIdPsico = '';
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncPsicofarmacosState.processed >= syncPsicofarmacosState.total
      ) {
        break;
      }

      batchNumber++;
      syncPsicofarmacosState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            IDPsicofarmaco AS idpsicofarmaco,
            Nombre         AS nombre
          FROM psicofarmacos
          WHERE (? = '' OR IDPsicofarmaco > ?)
          ORDER BY IDPsicofarmaco
          LIMIT ?
        `,
        [lastIdPsico, lastIdPsico, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote psicofarmacos #${batchNumber} → ${rows.length} registros (desde IDPsicofarmaco > ${lastIdPsico || '[inicio]'})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastIdPsicoInBatch = lastIdPsico;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncPsicofarmacosState.processed + processedInBatch >=
              syncPsicofarmacosState.total
          ) {
            break;
          }

          batchToInsert.push({
            idpsicofarmaco: r.idpsicofarmaco,
            nombre: r.nombre,
          });

          processedInBatch++;
          lastIdPsicoInBatch = r.idpsicofarmaco;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('psicofarmacos')
          .upsert(batchToInsert, { onConflict: 'idpsicofarmaco' });

        if (upsertError) {
          throw upsertError;
        }

        lastIdPsico = lastIdPsicoInBatch;
        syncPsicofarmacosState.processed += processedInBatch;

        console.log(
          `✅ Lote psicofarmacos #${batchNumber} confirmado — procesados: ${syncPsicofarmacosState.processed}/${syncPsicofarmacosState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote psicofarmacos:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert(
          { key: 'psicofarmacos', completed: true },
          { onConflict: 'key' }
        );
      if (error) {
        throw error;
      }
    }

    syncPsicofarmacosState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'psicofarmacos',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync psicofarmacos completado — ${syncPsicofarmacosState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync psicofarmacos FINALIZADO → ${syncPsicofarmacosState.processed} registros en ${duration}s`
    );

    return {
      processed: syncPsicofarmacosState.processed,
      total: syncPsicofarmacosState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync psicofarmacos:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert(
        { key: 'psicofarmacos', completed: false },
        { onConflict: 'key' }
      );

    await supabase.from('audit_log').insert({
      entity: 'psicofarmacos',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncPsicofarmacosState.inProgress = false;
  }
}

module.exports = { syncPsicofarmacosLegacyToSupabase, syncPsicofarmacosState };

