require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_MEDICAMENTOS || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC medicamentos
====================================================== */
let syncMedicamentosState = {
  entity: 'medicamentos',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza medicamentos desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según CodPlex
 */
async function syncMedicamentosLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncMedicamentosLegacyToSupabase llamado con dbType !== mysql, se omite.');
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

  if (syncMedicamentosState.inProgress) {
    console.log('⏸️ Sync medicamentos ya en progreso');
    return {
      processed: syncMedicamentosState.processed,
      total: syncMedicamentosState.total,
    };
  }

  syncMedicamentosState.entity = 'medicamentos';
  syncMedicamentosState.inProgress = true;
  syncMedicamentosState.completed = false;
  syncMedicamentosState.total = 0;
  syncMedicamentosState.processed = 0;
  syncMedicamentosState.startedAt = new Date();
  syncMedicamentosState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync medicamentos → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'medicamentos', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'medicamentos',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización medicamentos',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM medicamentos'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncMedicamentosState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncMedicamentosState.total = totalExterno;
    } else {
      syncMedicamentosState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastCodPlex = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(CodPlex) AS min_id
          FROM (
            SELECT CodPlex
            FROM medicamentos
            ORDER BY CodPlex DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastCodPlex = Number(minId) - 1;
      } else {
        lastCodPlex = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncMedicamentosState.processed >= syncMedicamentosState.total
      ) {
        break;
      }

      batchNumber++;
      syncMedicamentosState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            CodPlex        AS codplex,
            Troquel        AS troquel,
            CodLab         AS codlab,
            codebar        AS codebar,
            Producto       AS producto,
            Presentaci     AS presentaci,
            Precio         AS precio,
            Costo          AS costo,
            Activo         AS activo,
            CodRubro       AS cod_rubro,
            IDSubRubro     AS idsubrubro,
            IDPsicofarmaco AS idpsicofarmaco,
            visible        AS visible,
            Refrigeracion  AS refrigeracion
          FROM medicamentos
          WHERE CodPlex > ?
          ORDER BY CodPlex
          LIMIT ?
        `,
        [lastCodPlex, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote medicamentos #${batchNumber} → ${rows.length} registros (desde CodPlex > ${lastCodPlex})`
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let lastCodPlexInBatch = lastCodPlex;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncMedicamentosState.processed + processedInBatch >=
              syncMedicamentosState.total
          ) {
            break;
          }

          batchToInsert.push({
            codplex: r.codplex,
            troquel: r.troquel,
            codlab: r.codlab,
            codebar: r.codebar,
            producto: r.producto,
            presentaci: r.presentaci,
            precio: r.precio,
            costo: r.costo,
            activo: r.activo,
            cod_rubro: r.cod_rubro,
            idsubrubro: r.idsubrubro,
            idpsicofarmaco: r.idpsicofarmaco,
            visible: r.visible,
            refrigeracion: r.refrigeracion,
          });

          processedInBatch++;
          lastCodPlexInBatch = r.codplex;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const { error: upsertError } = await supabase
          .from('medicamentos')
          .upsert(batchToInsert, { onConflict: 'codplex' });

        if (upsertError) {
          throw upsertError;
        }

        lastCodPlex = lastCodPlexInBatch;
        syncMedicamentosState.processed += processedInBatch;

        console.log(
          `✅ Lote medicamentos #${batchNumber} confirmado — procesados: ${syncMedicamentosState.processed}/${syncMedicamentosState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote medicamentos:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'medicamentos', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncMedicamentosState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'medicamentos',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync medicamentos completado — ${syncMedicamentosState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync medicamentos FINALIZADO → ${syncMedicamentosState.processed} registros en ${duration}s`
    );

    return {
      processed: syncMedicamentosState.processed,
      total: syncMedicamentosState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync medicamentos:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'medicamentos', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'medicamentos',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncMedicamentosState.inProgress = false;
  }
}

module.exports = { syncMedicamentosLegacyToSupabase, syncMedicamentosState };

