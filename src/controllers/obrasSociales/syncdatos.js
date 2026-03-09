/**
 * Sincronización desde base de datos legacy (MySQL) hacia Supabase.
 * Orden: rubros → categorias → psicofarmacos → subrubros → sucursales → operadores → medicamentos.
 */
require('dotenv').config();

let pool;
let dbType = '';

try {
  const db = require('../../db');
  pool = db.pool;
  dbType = db.dbType || '';
} catch {
  pool = null;
}

const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_SYNC || '500', 10);

const syncState = {
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  entity: '',
  error: null,
};

async function upsertSyncStatus(supabase, key, completed) {
  await supabase.from('sync_status').upsert(
    { key, completed, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function auditLog(supabase, entity, action, status, message) {
  await supabase.from('audit_log').insert({
    entity,
    action,
    status,
    message: message || null,
  });
}

async function syncLegacyToSupabase({ mode = 'ALL', limit: limitParam } = {}) {
  if (!pool || dbType !== 'mysql') {
    console.warn('⚠️ Sync legacy→Supabase: se requiere MySQL (../../db con pool y dbType).');
    return { processed: 0, total: 0, duration: 0, entities: {} };
  }

  if (syncState.inProgress) {
    return { processed: syncState.processed, total: syncState.total, entities: {} };
  }

  syncState.inProgress = true;
  syncState.completed = false;
  syncState.processed = 0;
  syncState.total = 0;
  syncState.startedAt = new Date();
  syncState.entity = '';
  syncState.error = null;

  const startTime = Date.now();
  const supabase = getSupabaseAdmin();
  const results = {};

  try {
    await upsertSyncStatus(supabase, 'legacy_full', false);
    await auditLog(supabase, 'legacy', 'sync', 'START', 'Inicio sincronización legacy → Supabase');

    // 1. Rubros
    syncState.entity = 'rubros';
    const [rubrosRows] = await pool.query('SELECT CodRubro, Rubro FROM rubros');
    const rubros = Array.isArray(rubrosRows) ? rubrosRows : [];
    for (const r of rubros) {
      const { error } = await supabase.from('rubros').upsert(
        { codrubro: r.CodRubro, rubro: r.Rubro ?? null },
        { onConflict: 'codrubro' }
      );
      if (!error) syncState.processed++;
    }
    results.rubros = { total: rubros.length, processed: rubros.length };

    // 2. Categorias
    syncState.entity = 'categorias';
    const [catRows] = await pool.query('SELECT IDCategoria, Nombre FROM categorias');
    const categorias = Array.isArray(catRows) ? catRows : [];
    for (const r of categorias) {
      const { error } = await supabase.from('categorias').upsert(
        { idcategoria: r.IDCategoria, nombre: r.Nombre ?? null },
        { onConflict: 'idcategoria' }
      );
      if (!error) syncState.processed++;
    }
    results.categorias = { total: categorias.length, processed: categorias.length };

    // 3. Psicofarmacos
    syncState.entity = 'psicofarmacos';
    const [psiRows] = await pool.query('SELECT IDPsicofarmaco, Nombre FROM psicofarmacos');
    const psicofarmacos = Array.isArray(psiRows) ? psiRows : [];
    for (const r of psicofarmacos) {
      const { error } = await supabase.from('psicofarmacos').upsert(
        { idpsicofarmaco: r.IDPsicofarmaco ?? '', nombre: r.Nombre ?? null },
        { onConflict: 'idpsicofarmaco' }
      );
      if (!error) syncState.processed++;
    }
    results.psicofarmacos = { total: psicofarmacos.length, processed: psicofarmacos.length };

    // 4. Subrubros
    syncState.entity = 'subrubros';
    const [subRows] = await pool.query(
      'SELECT IDSubRubro, Nombre, IDRubro, IDCategoria FROM subrubros'
    );
    const subrubros = Array.isArray(subRows) ? subRows : [];
    for (const r of subrubros) {
      const { error } = await supabase.from('subrubros').upsert(
        {
          idsubrubro: r.IDSubRubro,
          nombre: r.Nombre ?? null,
          idrubro: r.IDRubro,
          idcategoria: r.IDCategoria ?? null,
        },
        { onConflict: 'idsubrubro' }
      );
      if (!error) syncState.processed++;
    }
    results.subrubros = { total: subrubros.length, processed: subrubros.length };

    // 5. Sucursales
    syncState.entity = 'sucursales';
    const [sucRows] = await pool.query(`
      SELECT Sucursal, NombreFantasia, Domicilio, Telefono, Email, _CodPostal, contraseña, activa
      FROM sucursales
    `);
    const sucursales = Array.isArray(sucRows) ? sucRows : [];
    for (const r of sucursales) {
      const { error } = await supabase.from('sucursales').upsert(
        {
          sucursal: r.Sucursal,
          nombrefantasia: r.NombreFantasia ?? '',
          domicilio: r.Domicilio ?? null,
          telefono: r.Telefono ?? null,
          email: r.Email ?? null,
          _codpostal: r._CodPostal ?? null,
          contraseña: r.contraseña ?? '',
          activa: r.activa != null ? Boolean(r.activa) : true,
        },
        { onConflict: 'sucursal' }
      );
      if (!error) syncState.processed++;
    }
    results.sucursales = { total: sucursales.length, processed: sucursales.length };

    // 6. Operadores
    syncState.entity = 'operadores';
    const [opRows] = await pool.query(`
      SELECT IDOperador, Operador, NombreCompleto, Codigo, rol, Activo
      FROM operadores
    `);
    const operadores = Array.isArray(opRows) ? opRows : [];
    for (const r of operadores) {
      const { error } = await supabase.from('operadores').upsert(
        {
          idoperador: r.IDOperador,
          operador: r.Operador ?? '',
          nombrecompleto: r.NombreCompleto ?? '',
          codigo: r.Codigo ?? 0,
          rol: (r.rol && ['admin', 'operador_sucursal'].includes(r.rol)) ? r.rol : 'operador_sucursal',
          activo: r.Activo ?? 'S',
        },
        { onConflict: 'idoperador' }
      );
      if (!error) syncState.processed++;
    }
    results.operadores = { total: operadores.length, processed: operadores.length };

    // 7. Medicamentos (por lotes)
    syncState.entity = 'medicamentos';
    const [medRows] = await pool.query(`
      SELECT CodPlex, Troquel, CodLab, codebar, Producto, Presentaci, Precio, Costo,
             Activo, cod_rubro, IDSubrubro, IDPsicofarmaco, visible, Refrigeracion
      FROM medicamentos
    `);
    const medicamentos = Array.isArray(medRows) ? medRows : [];
    let medProcessed = 0;
    for (let i = 0; i < medicamentos.length; i += BATCH_SIZE) {
      const batch = medicamentos.slice(i, i + BATCH_SIZE);
      for (const r of batch) {
        const { error } = await supabase.from('medicamentos').upsert(
          {
            codplex: r.CodPlex,
            troquel: r.Troquel ?? null,
            codlab: r.CodLab ?? null,
            codebar: r.codebar ?? null,
            producto: r.Producto ?? null,
            presentaci: r.Presentaci ?? null,
            precio: r.Precio ?? null,
            costo: r.Costo ?? null,
            activo: r.Activo ?? null,
            cod_rubro: r.cod_rubro ?? 0,
            idsubrubro: r.IDSubrubro ?? null,
            idpsicofarmaco: r.IDPsicofarmaco ?? null,
            visible: r.visible != null ? Number(r.visible) : null,
            refrigeracion: r.Refrigeracion ?? null,
          },
          { onConflict: 'codplex' }
        );
        if (!error) {
          medProcessed++;
          syncState.processed++;
        }
      }
    }
    results.medicamentos = { total: medicamentos.length, processed: medProcessed };

    syncState.total = syncState.processed;
    syncState.completed = true;
    await upsertSyncStatus(supabase, 'legacy_full', true);
    await auditLog(
      supabase,
      'legacy',
      'sync',
      'SUCCESS',
      `Sync completado — ${syncState.processed} registros`
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🏁 Sync legacy→Supabase FINALIZADO → ${syncState.processed} registros en ${duration}s`);

    return {
      processed: syncState.processed,
      total: syncState.total,
      duration: Number(duration),
      entities: results,
    };
  } catch (e) {
    syncState.error = e.message;
    console.error('🔥 Error sync legacy→Supabase:', e);
    await upsertSyncStatus(supabase, 'legacy_full', false).catch(() => {});
    await auditLog(supabase, 'legacy', 'sync', 'ERROR', e.message).catch(() => {});
    throw e;
  } finally {
    syncState.inProgress = false;
  }
}

// Alias para mantener compatibilidad con rutas que llaman syncDatos
async function syncDatos(opts) {
  return syncLegacyToSupabase(opts);
}

module.exports = {
  syncDatos,
  syncLegacyToSupabase,
  syncState,
};
