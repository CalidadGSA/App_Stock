require('dotenv').config();

const dbInterna = require('../../dbInterna');
const { syncObrasSociales, syncState } = require('./syncobrasSociales');

/* ======================================================
   📡 GET /api/obrasSociales
   👉 SOLO LECTURA + estado de sync
====================================================== */
exports.getobrasSociales = async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  try {
    const where = search
      ? `
        WHERE
          descripcio ILIKE $1
      `
      : '';

    const params = search ? [`%${search}%`] : [];

    const { rows: countRows } = await dbInterna.query(
      `
        SELECT COUNT(*)::int AS total
        FROM obsociales
        ${where}
      `,
      params
    );

    const { rows } = await dbInterna.query(
      `
        SELECT *
        FROM obsociales
        ${where}
        ORDER BY codobsoc DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total: countRows[0].total,
      data: rows,
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
    console.error('💥 Error leyendo obras sociales:', error);
    res.status(500).json({ message: 'Error al obtener obras sociales' });
  }
};

/* ======================================================
   🔄 POST /api/obrasSociales/sync
   👉 DISPARO MANUAL DE SYNC (background)
====================================================== */
exports.syncobrasSocialesManual = (req, res) => {
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
      await syncObrasSociales({ mode, limit });
    } catch (e) {
      console.error('❌ Error sync background obras sociales:', e);
    }
  });

  res.json({
    success: true,
    message: 'Sync obras sociales iniciado',
    syncMode: mode || 'ALL',
    limit: limit || null,
  });
};

