require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_STOCK || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC stock
====================================================== */
let syncStockState = {
  entity: 'stock',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza stock desde la base externa (MySQL) hacia Supabase.
 * Modo simple: recorre toda la tabla `stock` de la base legacy en lotes
 * y hace upsert sobre la tabla `stock` interna (Sucursal + IDProducto).
 */
async function syncStockLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncStockLegacyToSupabase llamado con dbType !== mysql, se omite.');
    return { processed: 0, total: 0, duration: 0 };
  }

  const supabase = getSupabaseAdmin();

  // Modo de sync: ALL (todos) o LAST (últimos N según límite)
  const requestedMode = (mode || process.env.SYNC_MODE || 'ALL').toUpperCase();
  let SYNC_MODE_LOCAL = requestedMode;

  if (requestedMode === 'LAST' && (SYNC_LIMIT <= 0 && !(typeof limitParam === 'number' && limitParam > 0))) {
    console.warn(
      '⚠️ SYNC_MODE=LAST para stock pero sin límite efectivo (SYNC_LIMIT/limit<=0) → se usa ALL'
    );
    SYNC_MODE_LOCAL = 'ALL';
  }

  if (syncStockState.inProgress) {
    console.log('⏸️ Sync stock ya en progreso');
    return {
      processed: syncStockState.processed,
      total: syncStockState.total,
    };
  }

  const effectiveLimit =
    typeof limitParam === 'number' && limitParam > 0 ? limitParam : SYNC_LIMIT;

  syncStockState.entity = 'stock';
  syncStockState.inProgress = true;
  syncStockState.completed = false;
  syncStockState.total = 0;
  syncStockState.processed = 0;
  syncStockState.startedAt = new Date();
  syncStockState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync stock → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'stock', completed: false }, { onConflict: 'key' });
      if (error) throw error;
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'stock',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización stock',
      });
      if (error) throw error;
    }

    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM stock');
    const totalExterno = Number(countRows[0]?.total || 0);

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncStockState.total = Math.min(effectiveLimit, totalExterno);
    } else {
      syncStockState.total =
        effectiveLimit > 0 ? Math.min(effectiveLimit, totalExterno) : totalExterno;
    }

    let offset = 0;
    let batchNumber = 0;

    while (true) {
      // Para modo LAST respetamos el límite efectivo;
      // para ALL solo se corta cuando no hay más filas.
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncStockState.processed >= syncStockState.total
      ) {
        break;
      }

      batchNumber += 1;
      syncStockState.batchNumber = batchNumber;

      const limit = BATCH_SIZE;
      const remaining =
        effectiveLimit > 0
          ? Math.min(limit, syncStockState.total - syncStockState.processed)
          : limit;

      if (remaining <= 0) break;

      const [rows] = await pool.query(
        `
          SELECT
            Sucursal,
            IDProducto,
            Cantidad,
            Unidades,
            UnidadesProd
          FROM stock
          ORDER BY Sucursal, IDProducto
          LIMIT ?
          OFFSET ?
        `,
        [remaining, offset]
      );

      if (!rows.length) break;

      offset += rows.length;

      try {
        console.log(
          `📦 Lote stock #${batchNumber} → ${rows.length} registros (offset ${offset - rows.length})`
        );

        // OJO: en Postgres los nombres de columnas son minúsculas
        // (sucursal, idproducto, cantidad, unidades, unidadesprod),
        // así que el payload al upsert tiene que usar esos nombres.
        const batchToInsert = rows.map((r) => ({
          sucursal: r.Sucursal,
          idproducto: r.IDProducto,
          cantidad: r.Cantidad ?? 0,
          unidades: r.Unidades ?? 0,
          unidadesprod: r.UnidadesProd ?? 1,
          actualizado: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from('stock')
          .upsert(batchToInsert, { onConflict: 'sucursal,idproducto' });

        if (upsertError) {
          throw upsertError;
        }

        syncStockState.processed += rows.length;

        console.log(
          `✅ Lote stock #${batchNumber} confirmado — procesados: ${syncStockState.processed}/${syncStockState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote stock:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'stock', completed: true }, { onConflict: 'key' });
      if (error) throw error;
    }

    syncStockState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'stock',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync stock completado — ${syncStockState.processed} registros sincronizados`,
      });
      if (error) throw error;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync stock FINALIZADO → ${syncStockState.processed} registros en ${duration}s`
    );

    return {
      processed: syncStockState.processed,
      total: syncStockState.total,
      duration: Number(duration),
    };
  } catch (error) {
    console.error('💥 Error en sync stock:', error);

    await getSupabaseAdmin()
      .from('audit_log')
      .insert({
        entity: 'stock',
        action: 'sync',
        status: 'ERROR',
        message: error.message || String(error),
      });

    throw error;
  } finally {
    syncStockState.inProgress = false;
  }
}

module.exports = {
  syncStockLegacyToSupabase,
  syncStockState,
};

