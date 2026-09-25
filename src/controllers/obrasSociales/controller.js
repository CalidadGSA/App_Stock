require('dotenv').config();

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { pool, dbType } = require('../../db');
const { syncLegacyToSupabase, syncState } = require('./syncdatos');
const {
  syncOperadoresLegacyToSupabase,
  syncOperadoresState,
} = require('./syncoperadores');
const {
  syncStockLegacyToSupabase,
  syncStockState,
} = require('./syncstock');
const {
  syncUsuariosQuantioToSupabase,
  syncUsuariosQuantioState,
} = require('./syncusuariosquantio');
const {
  syncProductosQuantioToSupabase,
  syncProductosQuantioState,
} = require('./syncproductosquantio');

/* ======================================================
   📡 GET /api/datos  (sucursales en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getdatos = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('sucursales')
      .select('sucursal, nombrefantasia, domicilio, telefono, email, _codpostal', {
        count: 'exact',
      });

    if (hasSearch) {
      // Búsqueda básica por nombre de fantasía o código de sucursal
      query = query.or(
        `nombrefantasia.ilike.%${search}%,sucursal::text.ilike.%${search}%`
      );
    }

    query = query.order('sucursal', { ascending: true }).range(
      offset,
      offset + limit - 1
    );

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      page,
      limit,
      total: count || 0,
      data: data || [],
      sync: {
        inProgress: syncState.inProgress,
        completed: syncState.completed,
        total: syncState.total,
        processed: syncState.processed,
        percent:
          syncState.total > 0
            ? Math.round((syncState.processed / syncState.total) * 100)
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo sucursales desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener sucursales' });
  }
};



exports.syncusuariosquantio = (_req, res) => {
  if (syncUsuariosQuantioState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de usuarios Quantio ya en progreso',
      state: syncUsuariosQuantioState,
    });
  }

  void syncUsuariosQuantioToSupabase().catch((e) => {
    console.error('❌ Error sync background usuarios Quantio:', e);
  });

  res.json({
    success: true,
    message: 'Sync usuarios Quantio iniciado',
    state: syncUsuariosQuantioState,
  });
};

exports.syncproductosquantio = (_req, res) => {
  if (syncProductosQuantioState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de productos Quantio ya en progreso',
      state: syncProductosQuantioState,
    });
  }

  void syncProductosQuantioToSupabase().catch((e) => {
    console.error('❌ Error sync background productos Quantio:', e);
  });

  res.json({
    success: true,
    message: 'Sync productos Quantio iniciado',
    state: syncProductosQuantioState,
  });
};


/* ======================================================
   📡 GET /api/datos/externos  (sucursales en base legacy MySQL)
   👉 SOLO LECTURA (sin pasar por Supabase)
====================================================== */
exports.getdatosExternos = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  if (dbType !== 'mysql') {
    return res.status(501).json({
      message:
        'Base legacy no configurada como mysql (LEGACY_DB_TYPE!==mysql), no hay datos externos',
    });
  }

  try {
    const params = [];
    let where = '';

    if (search) {
      where = `
        WHERE
          NombreFantasia LIKE ?
          OR CAST(Sucursal AS CHAR) LIKE ?
      `;
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countRows] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM sucursales
        ${where}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query(
      `
        SELECT
          Sucursal,
          NombreFantasia,
          Domicilio,
          Telefono,
          Email,
          _CodPostal
        FROM sucursales
        ${where}
        ORDER BY Sucursal
        LIMIT ?
        OFFSET ?
      `,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total,
      data: rows,
      source: 'legacy-mysql',
    });
  } catch (error) {
    console.error('💥 Error leyendo sucursales desde base externa MySQL:', error);
    res
      .status(500)
      .json({ message: 'Error al obtener sucursales desde base externa' });
  }
};

/* ======================================================
   📡 GET /api/datos/operadores  (operadores en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getoperadores = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('operadores')
      .select('idoperador, operador, nombrecompleto, codigo, activo', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        `operador.ilike.%${search}%,nombrecompleto.ilike.%${search}%,idoperador::text.ilike.%${search}%`
      );
    }

    query = query
      .order('idoperador', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      page,
      limit,
      total: count || 0,
      data: data || [],
      sync: {
        inProgress: syncOperadoresState.inProgress,
        completed: syncOperadoresState.completed,
        total: syncOperadoresState.total,
        processed: syncOperadoresState.processed,
        percent:
          syncOperadoresState.total > 0
            ? Math.round(
                (syncOperadoresState.processed / syncOperadoresState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo operadores desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener operadores' });
  }
};




/* ======================================================
   📡 GET /api/datos/stock  (stock en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getstock = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('stock')
      .select('Sucursal, IDProducto, Cantidad, Unidades, UnidadesProd', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        [
          `Sucursal::text.ilike.%${search}%`,
          `IDProducto::text.ilike.%${search}%`,
        ].join(',')
      );
    }

    query = query
      .order('Sucursal', { ascending: true })
      .order('IDProducto', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      page,
      limit,
      total: count || 0,
      data: data || [],
      sync: {
        inProgress: syncStockState.inProgress,
        completed: syncStockState.completed,
        total: syncStockState.total,
        processed: syncStockState.processed,
        percent:
          syncStockState.total > 0
            ? Math.round((syncStockState.processed / syncStockState.total) * 100)
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo stock desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener stock' });
  }
};

/* ======================================================
   🔄 POST /api/sync/stock  (dispara sync legacy → Supabase)
====================================================== */
exports.syncstock = async (req, res) => {
  const limit = req.body?.limit ? Number(req.body.limit) : undefined;

  try {
    const result = await syncStockLegacyToSupabase({ limit });
    res.json({
      message: 'Sync stock iniciado/completado',
      result,
      state: syncStockState,
    });
  } catch (error) {
    console.error('💥 Error disparando sync stock:', error);
    res.status(500).json({ message: 'Error al sincronizar stock' });
  }
};





/* ======================================================
   🔄 POST /api/datos/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncdatos = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background sucursales:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync sucursales iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

/* ======================================================
   🔄 POST /api/datos/operadores/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncoperadores = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncOperadoresState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de operadores ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncOperadoresLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background operadores:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync operadores iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};






/* ======================================================
   👀 GET /api/datos/sync/debug
   👉 Vista temporal para ver configuración y estado de sync
====================================================== */
exports.getSyncDebug = async (_req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data: statusRow } = await supabase
      .from('sync_status')
      .select('key, completed, updated_at')
      .eq('key', 'sucursales')
      .maybeSingle();

    res.json({
      cronExpression:
        process.env.SYNC_CRON_DATOS ||
        process.env.SYNC_CRON_SUCURSALES ||
        process.env.SYNC_CRON_sucursales ||
        '45 3 * * *',
      timezone: process.env.TZ || 'America/Argentina/Buenos_Aires',
      syncState,
      syncStatusRow: statusRow || null,
    });
  } catch (error) {
    console.error('💥 Error obteniendo debug de sync:', error);
    res.status(500).json({ message: 'Error al obtener debug de sync' });
  }
};

