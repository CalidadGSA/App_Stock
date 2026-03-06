/**
 * API: listado desde Supabase y disparo de sync legacy → Supabase.
 * Mantiene rutas /api/datos por compatibilidad.
 */
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { syncLegacyToSupabase, syncState } = require('./syncdatos');

/** GET /api/datos — listado de sucursales desde Supabase + estado de sync */
exports.getdatos = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const search = (req.query.search || '').trim();
  const offset = (page - 1) * limit;

  try {
    const supabase = getSupabaseAdmin();

    let query = supabase.from('sucursales').select('*', { count: 'exact', head: true });
    if (search) {
      query = query.or(`nombrefantasia.ilike.%${search}%,domicilio.ilike.%${search}%`);
    }
    const { count, error: countError } = await query;

    if (countError) {
      return res.status(500).json({ message: 'Error al contar sucursales', error: countError.message });
    }

    let dataQuery = supabase
      .from('sucursales')
      .select('*')
      .order('sucursal', { ascending: false })
      .range(offset, offset + limit - 1);
    if (search) {
      dataQuery = dataQuery.or(`nombrefantasia.ilike.%${search}%,domicilio.ilike.%${search}%`);
    }
    const { data: rows, error } = await dataQuery;

    if (error) {
      return res.status(500).json({ message: 'Error al obtener sucursales', error: error.message });
    }

    res.json({
      page,
      limit,
      total: count ?? 0,
      data: rows ?? [],
      sync: {
        inProgress: syncState.inProgress,
        completed: syncState.completed,
        total: syncState.total,
        processed: syncState.processed,
        entity: syncState.entity,
        error: syncState.error,
        percent:
          syncState.total > 0
            ? Math.round((syncState.processed / syncState.total) * 100)
            : 0,
      },
    });
  } catch (e) {
    console.error('Error leyendo sucursales:', e);
    res.status(500).json({ message: 'Error al obtener sucursales' });
  }
};

/** POST /api/datos/sync — disparo manual de sync legacy → Supabase (en background) */
exports.syncdatos = (req, res) => {
  const mode = req.body?.mode || 'ALL';
  const limit =
    typeof req.body?.limit === 'number'
      ? req.body.limit
      : req.body?.limit
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
      console.error('Error sync legacy→Supabase:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync legacy → Supabase iniciado',
    syncMode: mode,
    limit: limit ?? null,
  });
};
