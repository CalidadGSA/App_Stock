require('dotenv').config();

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { getQuantioPool } = require('./syncusuariosquantio');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_PRODUCTOS_QUANTIO || '2000', 10);

let syncProductosQuantioState = {
  entity: 'productos_quantio',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

function mapProductoRow(r) {
  return {
    idproducto: Number(r.IDProducto),
    producto: r.Producto ?? null,
    presentacion: r.Presentacion ?? null,
    prod_pres: r.ProdPres ?? null,
    codebar: r.Codebar ?? null,
    troquel: r.Troquel == null ? null : Number(r.Troquel),
    unidades: r.Unidades == null ? null : Number(r.Unidades),
    activo: r.Activo ?? null,
    refrigeracion: r.Refrigeracion ?? null,
    idlaboratorio: r.IDLaboratorio == null ? null : Number(r.IDLaboratorio),
    idrubro: r.IDRubro == null ? null : Number(r.IDRubro),
    idsubrubro: r.IDSubRubro == null ? null : Number(r.IDSubRubro),
    idpsicofarmaco: r.IDPsicofarmaco ?? null,
    gtin: r.gtin ?? null,
    costo: Number(r.Costo ?? 0),
    ultimoprecio: Number(r.UltimoPrecio ?? 0),
    actualizado: new Date().toISOString(),
  };
}

async function syncProductosQuantioToSupabase() {
  const quantioPool = getQuantioPool();
  if (!quantioPool) {
    console.warn('⚠️ Variables QUANTIO_DB_* incompletas, se omite sync productos Quantio');
    return { processed: 0, total: 0, duration: 0 };
  }

  if (syncProductosQuantioState.inProgress) {
    return {
      processed: syncProductosQuantioState.processed,
      total: syncProductosQuantioState.total,
    };
  }

  const supabase = getSupabaseAdmin();
  syncProductosQuantioState.inProgress = true;
  syncProductosQuantioState.completed = false;
  syncProductosQuantioState.processed = 0;
  syncProductosQuantioState.batchNumber = 0;
  const startTime = Date.now();

  try {
    const [countRows] = await quantioPool.query(
      "SELECT COUNT(*) AS total FROM productos WHERE COALESCE(Activo, 'S') IN ('S', '1')"
    );
    syncProductosQuantioState.total = Number(countRows[0]?.total) || 0;

    await supabase
      .from('sync_status')
      .upsert({ key: 'productos_quantio', completed: false }, { onConflict: 'key' });

    let lastId = 0;
    let batchNumber = 0;

    while (true) {
      batchNumber++;
      syncProductosQuantioState.batchNumber = batchNumber;

      const [rows] = await quantioPool.query(
        `
          SELECT
            IDProducto, Producto, Presentacion, ProdPres, Codebar, Troquel, Unidades,
            Activo, Refrigeracion, IDLaboratorio, IDRubro, IDSubRubro, IDPsicofarmaco,
            gtin, Costo, UltimoPrecio
          FROM productos
          WHERE IDProducto > ?
          ORDER BY IDProducto
          LIMIT ?
        `,
        [lastId, BATCH_SIZE]
      );

      if (!rows.length) break;

      const batch = rows.map(mapProductoRow).filter((r) => Number.isFinite(r.idproducto));
      if (!batch.length) break;

      const { error: upsertError } = await supabase
        .from('productos_quantio')
        .upsert(batch, { onConflict: 'idproducto' });

      if (upsertError) throw upsertError;

      lastId = batch[batch.length - 1].idproducto;
      syncProductosQuantioState.processed += batch.length;

      console.log(
        `✅ Lote productos Quantio #${batchNumber} — ${batch.length} (total ${syncProductosQuantioState.processed})`
      );

      if (rows.length < BATCH_SIZE) break;
    }

    await supabase
      .from('sync_status')
      .upsert({ key: 'productos_quantio', completed: true }, { onConflict: 'key' });

    syncProductosQuantioState.completed = true;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      processed: syncProductosQuantioState.processed,
      total: syncProductosQuantioState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync productos Quantio:', e);
    throw e;
  } finally {
    syncProductosQuantioState.inProgress = false;
  }
}

module.exports = { syncProductosQuantioToSupabase, syncProductosQuantioState };
