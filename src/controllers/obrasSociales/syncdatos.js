require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_SUCURSALES || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC sucursales
====================================================== */
let syncState = {
  entity: 'sucursales',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza sucursales desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según Sucursal
 */
async function syncLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncLegacyToSupabase llamado con dbType !== mysql, se omite.');
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

  if (syncState.inProgress) {
    console.log('⏸️ Sync sucursales ya en progreso');
    return { processed: syncState.processed, total: syncState.total };
  }

  syncState.entity = 'sucursales';
  syncState.inProgress = true;
  syncState.completed = false;
  syncState.total = 0;
  syncState.processed = 0;
  syncState.startedAt = new Date();
  syncState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync sucursales → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert(
          { key: 'sucursales', completed: false },
          { onConflict: 'key' }
        );
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'sucursales',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización sucursales',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM sucursales'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncState.total = totalExterno;
    } else {
      syncState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastSucursal = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(Sucursal) AS min_id
          FROM (
            SELECT Sucursal
            FROM sucursales
            ORDER BY Sucursal DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastSucursal = Number(minId) - 1;
      } else {
        lastSucursal = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncState.processed >= syncState.total
      ) {
        break;
      }

      batchNumber++;
      syncState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            Sucursal      AS sucursal,
            NombreFantasia AS nombrefantasia,
            Domicilio     AS domicilio,
            Telefono      AS telefono,
            Email         AS email,
            _CodPostal    AS _codpostal
          FROM sucursales
          WHERE Sucursal > ?
          ORDER BY Sucursal
          LIMIT ?
        `,
        [lastSucursal, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote sucursales #${batchNumber} → ${rows.length} registros (desde Sucursal > ${lastSucursal})`
        );

        const sucursalIds = rows.map((r) => r.sucursal);
        const { data: existentes, error: fetchExistentesError } = await supabase
          .from('sucursales')
          .select('sucursal')
          .in('sucursal', sucursalIds);

        if (fetchExistentesError) {
          throw fetchExistentesError;
        }

        const existingSet = new Set(
          (existentes ?? []).map((e) => Number(e.sucursal))
        );

        const batchToInsert = [];
        let processedInBatch = 0;
        let skippedNew = 0;
        let lastSucursalInBatch = lastSucursal;

        for (const r of rows) {
          lastSucursalInBatch = r.sucursal;

          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncState.processed + processedInBatch >= syncState.total
          ) {
            break;
          }

          if (!existingSet.has(Number(r.sucursal))) {
            skippedNew++;
            continue;
          }

          batchToInsert.push({
            sucursal: r.sucursal,
            nombrefantasia: r.nombrefantasia,
            domicilio: r.domicilio,
            telefono: r.telefono,
            email: r.email,
            _codpostal: r._codpostal,
          });

          processedInBatch++;
        }

        if (skippedNew > 0) {
          console.warn(
            `⚠️ Lote #${batchNumber}: ${skippedNew} sucursal(es) nueva(s) omitida(s) (crear en Supabase con contraseña antes del sync)`
          );
        }

        if (!processedInBatch) {
          if (rows.length) {
            lastSucursal = lastSucursalInBatch;
          }
          if (skippedNew > 0 && skippedNew >= rows.length) {
            continue;
          }
          break;
        }

        const { error: upsertError } = await supabase
          .from('sucursales')
          .upsert(batchToInsert, { onConflict: 'sucursal' });

        if (upsertError) {
          throw upsertError;
        }

        lastSucursal = lastSucursalInBatch;
        syncState.processed += processedInBatch;

        console.log(
          `✅ Lote sucursales #${batchNumber} confirmado — procesados: ${syncState.processed}/${syncState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote sucursales:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert(
          { key: 'sucursales', completed: true },
          { onConflict: 'key' }
        );
      if (error) {
        throw error;
      }
    }

    syncState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'sucursales',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync sucursales completado — ${syncState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync sucursales FINALIZADO → ${syncState.processed} registros en ${duration}s`
    );

    return {
      processed: syncState.processed,
      total: syncState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync sucursales:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert(
        { key: 'sucursales', completed: false },
        { onConflict: 'key' }
      );

    await supabase.from('audit_log').insert({
      entity: 'sucursales',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncState.inProgress = false;
  }
}

module.exports = { syncLegacyToSupabase, syncState };
