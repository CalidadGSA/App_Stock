require('dotenv').config();

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { pool, dbType } = require('../../db');
const { syncLegacyToSupabase, syncState } = require('./syncdatos');
const {
  syncOperadoresLegacyToSupabase,
  syncOperadoresState,
} = require('./syncoperadores');
const {
  syncMedicamentosLegacyToSupabase,
  syncMedicamentosState,
} = require('./syncmedicamentos');
const {
  syncRubrosLegacyToSupabase,
  syncRubrosState,
} = require('./syncrubros');
const {
  syncSubrubrosLegacyToSupabase,
  syncSubrubrosState,
} = require('./syncsubrubros');
const {
  syncCategoriasLegacyToSupabase,
  syncCategoriasState,
} = require('./synccategorias');
const {
  syncPsicofarmacosLegacyToSupabase,
  syncPsicofarmacosState,
} = require('./syncpsicofarmacos');
const {
  syncStockLegacyToSupabase,
  syncStockState,
} = require('./syncstock');
const {
  syncLaboratoriosLegacyToSupabase,
  syncLaboratoriosState,
} = require('./synclaboratorios');
const {
  testQuantioConnection,
  syncProductosCodebarsFromQuantio,
  syncProductosCodebarsState,
} = require('./syncproductoscodebars');
const {
  syncMedicamentosCodebars,
  syncMedicamentosCodebarsState,
} = require('./syncmedicamentosCodebars');

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

/* ======================================================
   🔎 GET /api/datos/productoscodebars/test-connection
   👉 Prueba la conexión a Quantio y valida acceso a la tabla productoscodebars
====================================================== */
exports.testproductoscodebarsconnection = async (_req, res) => {
  try {
    const result = await testQuantioConnection();
    res.status(result.ok ? 200 : 503).json(result);
  } catch (e) {
    console.error('💥 Error testeando conexión Quantio:', e);
    res.status(500).json({
      ok: false,
      message: 'Error inesperado al probar la conexión con Quantio.',
      error: e.message,
    });
  }
};

/* ======================================================
   🔄 POST /api/datos/productoscodebars/sync (Quantio → Supabase)
   👉 Copia IDProducto + codebar desde Quantio a la tabla productoscodebars
====================================================== */
exports.syncproductoscodebars = (req, res) => {
  const limit =
    typeof req.body?.limit === 'number'
      ? req.body.limit
      : req.body?.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncProductosCodebarsState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de productoscodebars ya en progreso',
      state: syncProductosCodebarsState,
    });
  }

  void syncProductosCodebarsFromQuantio({ limit }).catch(e => {
    console.error('❌ Error sync background productoscodebars:', e);
  });

  res.json({
    success: true,
    message: 'Sync productoscodebars iniciado',
    limit: limit || null,
    state: syncProductosCodebarsState,
  });
};

/* ======================================================
   🔄 POST /api/datos/medicamentos/codebars/sync
   👉 Cruza medicamentos.codplex con productoscodebars.idproducto y
      rellena codebar2, codebar3 y codebar4
====================================================== */
exports.syncmedicamentoscodebars = async (req, res) => {
  if (syncMedicamentosCodebarsState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de medicamentos codebars ya en progreso',
      state: syncMedicamentosCodebarsState,
    });
  }

  void syncMedicamentosCodebars().catch(e => {
    console.error('❌ Error sync background medicamentos codebars:', e);
  });

  res.json({
    success: true,
    message: 'Sync medicamentos codebars iniciado',
    state: syncMedicamentosCodebarsState,
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
   📡 GET /api/datos/medicamentos  (medicamentos en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getmedicamentos = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('medicamentos')
      .select(
        'codplex, troquel, codlab, codebar, producto, presentaci, precio, costo, activo, cod_rubro, idsubrubro, idpsicofarmaco, visible, refrigeracion',
        {
          count: 'exact',
        }
      );

    if (hasSearch) {
      query = query.or(
        [
          `producto.ilike.%${search}%`,
          `codebar.ilike.%${search}%`,
          `codplex::text.ilike.%${search}%`,
        ].join(',')
      );
    }

    query = query
      .order('codplex', { ascending: true })
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
        inProgress: syncMedicamentosState.inProgress,
        completed: syncMedicamentosState.completed,
        total: syncMedicamentosState.total,
        processed: syncMedicamentosState.processed,
        percent:
          syncMedicamentosState.total > 0
            ? Math.round(
                (syncMedicamentosState.processed /
                  syncMedicamentosState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo medicamentos desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener medicamentos' });
  }
};

/* ======================================================
   📡 GET /api/datos/laboratorios  (laboratorios en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getlaboratorios = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('laboratorios')
      .select('codlab, laborato', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        [
          `laborato.ilike.%${search}%`,
          `codlab::text.ilike.%${search}%`,
        ].join(',')
      );
    }

    query = query
      .order('codlab', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      page,
      limit,
      total: count || 0,
      data: data || [],
      sync: {
        inProgress: syncLaboratoriosState.inProgress,
        completed: syncLaboratoriosState.completed,
        total: syncLaboratoriosState.total,
        processed: syncLaboratoriosState.processed,
        percent:
          syncLaboratoriosState.total > 0
            ? Math.round(
                (syncLaboratoriosState.processed / syncLaboratoriosState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo laboratorios desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener laboratorios' });
  }
};

/* ======================================================
   🔄 POST /api/sync/laboratorios  (dispara sync legacy → Supabase)
====================================================== */
exports.synclaboratorios = async (req, res) => {
  const limit = req.body?.limit ? Number(req.body.limit) : undefined;
  const mode =
    typeof req.body?.mode === 'string' ? req.body.mode : process.env.SYNC_MODE || 'ALL';

  try {
    const result = await syncLaboratoriosLegacyToSupabase({ mode, limit });
    res.json({
      message: 'Sync laboratorios iniciado/completado',
      result,
      state: syncLaboratoriosState,
    });
  } catch (error) {
    console.error('💥 Error disparando sync laboratorios:', error);
    res.status(500).json({ message: 'Error al sincronizar laboratorios' });
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
   📡 GET /api/datos/rubros  (rubros en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getrubros = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('rubros')
      .select('codrubro, rubro', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        `rubro.ilike.%${search}%,codrubro::text.ilike.%${search}%`
      );
    }

    query = query
      .order('codrubro', { ascending: true })
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
        inProgress: syncRubrosState.inProgress,
        completed: syncRubrosState.completed,
        total: syncRubrosState.total,
        processed: syncRubrosState.processed,
        percent:
          syncRubrosState.total > 0
            ? Math.round(
                (syncRubrosState.processed / syncRubrosState.total) * 100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo rubros desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener rubros' });
  }
};

/* ======================================================
   📡 GET /api/datos/subrubros  (subrubros en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getsubrubros = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('subrubros')
      .select('idsubrubro, nombre, idrubro, idcategoria', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        [
          `nombre.ilike.%${search}%`,
          `idsubrubro::text.ilike.%${search}%`,
          `idrubro::text.ilike.%${search}%`,
        ].join(',')
      );
    }

    query = query
      .order('idsubrubro', { ascending: true })
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
        inProgress: syncSubrubrosState.inProgress,
        completed: syncSubrubrosState.completed,
        total: syncSubrubrosState.total,
        processed: syncSubrubrosState.processed,
        percent:
          syncSubrubrosState.total > 0
            ? Math.round(
                (syncSubrubrosState.processed /
                  syncSubrubrosState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo subrubros desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener subrubros' });
  }
};

/* ======================================================
   📡 GET /api/datos/categorias  (categorias en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getcategorias = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('categorias')
      .select('idcategoria, nombre', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        `nombre.ilike.%${search}%,idcategoria::text.ilike.%${search}%`
      );
    }

    query = query
      .order('idcategoria', { ascending: true })
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
        inProgress: syncCategoriasState.inProgress,
        completed: syncCategoriasState.completed,
        total: syncCategoriasState.total,
        processed: syncCategoriasState.processed,
        percent:
          syncCategoriasState.total > 0
            ? Math.round(
                (syncCategoriasState.processed /
                  syncCategoriasState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo categorias desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener categorias' });
  }
};

/* ======================================================
   📡 GET /api/datos/psicofarmacos  (psicofarmacos en Supabase)
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getpsicofarmacos = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    const hasSearch = !!search;
    let query = supabase
      .from('psicofarmacos')
      .select('idpsicofarmaco, nombre', {
        count: 'exact',
      });

    if (hasSearch) {
      query = query.or(
        `nombre.ilike.%${search}%,idpsicofarmaco.ilike.%${search}%`
      );
    }

    query = query
      .order('idpsicofarmaco', { ascending: true })
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
        inProgress: syncPsicofarmacosState.inProgress,
        completed: syncPsicofarmacosState.completed,
        total: syncPsicofarmacosState.total,
        processed: syncPsicofarmacosState.processed,
        percent:
          syncPsicofarmacosState.total > 0
            ? Math.round(
                (syncPsicofarmacosState.processed /
                  syncPsicofarmacosState.total) *
                  100
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('💥 Error leyendo psicofarmacos desde Supabase:', error);
    res.status(500).json({ message: 'Error al obtener psicofarmacos' });
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
   🔄 POST /api/datos/medicamentos/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncmedicamentos = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncMedicamentosState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de medicamentos ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncMedicamentosLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background medicamentos:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync medicamentos iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

/* ======================================================
   🔄 POST /api/datos/rubros/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncrubros = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncRubrosState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de rubros ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncRubrosLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background rubros:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync rubros iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

/* ======================================================
   🔄 POST /api/datos/subrubros/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncsubrubros = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncSubrubrosState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de subrubros ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncSubrubrosLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background subrubros:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync subrubros iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

/* ======================================================
   🔄 POST /api/datos/categorias/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.synccategorias = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncCategoriasState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de categorias ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncCategoriasLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background categorias:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync categorias iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

/* ======================================================
   🔄 POST /api/datos/psicofarmacos/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncpsicofarmacos = (req, res) => {
  const mode = req.body.mode || undefined;
  const limit =
    typeof req.body.limit === 'number'
      ? req.body.limit
      : req.body.limit
      ? parseInt(req.body.limit, 10)
      : undefined;

  if (syncPsicofarmacosState.inProgress) {
    return res.status(409).json({
      success: false,
      message: 'Sync de psicofarmacos ya en progreso',
    });
  }

  setImmediate(async () => {
    try {
      await syncPsicofarmacosLegacyToSupabase({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background psicofarmacos:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync psicofarmacos iniciado',
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

