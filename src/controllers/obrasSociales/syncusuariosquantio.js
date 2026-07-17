require('dotenv').config();

const mysql = require('mysql2/promise');
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

const QUANTIO_OPERADOR_ID_OFFSET = 10_000_000;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_USUARIOS_QUANTIO || '500', 10);

let pool = null;

function getQuantioPool() {
  if (pool) return pool;

  const host = process.env.QUANTIO_DB_HOST;
  const port = parseInt(process.env.QUANTIO_DB_PORT || '3306', 10);
  const user = process.env.QUANTIO_DB_USER;
  const password = process.env.QUANTIO_DB_PASSWORD;
  const database = process.env.QUANTIO_DB_NAME;

  if (!host || !user || !password || !database) {
    return null;
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
}

let syncUsuariosQuantioState = {
  entity: 'usuarios_quantio',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

function normalizarActivo(valor) {
  const v = String(valor ?? '').trim().toUpperCase();
  if (v === 'S' || v === '1' || v === 'T' || v === 'Y') return 'S';
  return 'N';
}

function esSiQuantio(valor) {
  const v = String(valor ?? '').trim().toUpperCase();
  return v === 'S' || v === '1' || v === 'T' || v === 'Y';
}

function rolDesdeAdministradorQuantio(administrador) {
  return esSiQuantio(administrador) ? 'admin' : 'operador_sucursal';
}

function mapUsuarioRow(r) {
  const idUsuario = Number(r.IDUsuario ?? r.idusuario);
  const nombre = String(r.Nombre ?? r.nombre ?? '').trim().toUpperCase();
  const nombreCompleto = String(r.NombreCompleto ?? r.nombrecompleto ?? nombre).trim() || nombre;
  const codigo = Number(r.Codigo ?? r.codigo);
  const rol = rolDesdeAdministradorQuantio(r.Administrador ?? r.administrador);

  return {
    idoperador: QUANTIO_OPERADOR_ID_OFFSET + idUsuario,
    operador: nombre,
    nombrecompleto: nombreCompleto,
    codigo,
    activo: normalizarActivo(r.Activo ?? r.activo),
    fuente: 'quantio',
    rol,
    administrador: r.Administrador ?? r.administrador,
  };
}

async function resolverAppRoleIdPorRol(supabase, rol) {
  const { data } = await supabase.from('app_roles').select('id').eq('codigo', rol).maybeSingle();
  return data?.id ?? null;
}

async function syncUsuariosQuantioToSupabase() {
  const quantioPool = getQuantioPool();
  if (!quantioPool) {
    console.warn('⚠️ Variables QUANTIO_DB_* incompletas, se omite sync usuarios Quantio');
    return { processed: 0, total: 0, duration: 0 };
  }

  if (syncUsuariosQuantioState.inProgress) {
    return {
      processed: syncUsuariosQuantioState.processed,
      total: syncUsuariosQuantioState.total,
    };
  }

  const supabase = getSupabaseAdmin();
  syncUsuariosQuantioState.inProgress = true;
  syncUsuariosQuantioState.completed = false;
  syncUsuariosQuantioState.processed = 0;
  syncUsuariosQuantioState.batchNumber = 0;
  const startTime = Date.now();

  try {
    const [countRows] = await quantioPool.query('SELECT COUNT(*) AS total FROM usuarios');
    syncUsuariosQuantioState.total = Number(countRows[0]?.total) || 0;

    await supabase
      .from('sync_status')
      .upsert({ key: 'usuarios_quantio', completed: false }, { onConflict: 'key' });

    let lastId = 0;
    let batchNumber = 0;

    while (true) {
      batchNumber++;
      syncUsuariosQuantioState.batchNumber = batchNumber;

      const [rows] = await quantioPool.query(
        `
          SELECT IDUsuario, Nombre, NombreCompleto, Codigo, Activo, Administrador
          FROM usuarios
          WHERE IDUsuario > ?
          ORDER BY IDUsuario
          LIMIT ?
        `,
        [lastId, BATCH_SIZE]
      );

      if (!rows.length) break;

      const batch = [];
      const seen = new Set();

      for (const r of rows) {
        const mapped = mapUsuarioRow(r);
        if (!mapped.operador || !Number.isFinite(mapped.codigo)) continue;
        const key = `${mapped.operador}:${mapped.codigo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        batch.push(mapped);
        lastId = Number(r.IDUsuario);
      }

      if (!batch.length) {
        if (rows.length < BATCH_SIZE) break;
        continue;
      }

      const ids = batch.map((b) => b.idoperador);
      const { data: existentes, error: fetchError } = await supabase
        .from('operadores')
        .select('idoperador, rol')
        .in('idoperador', ids);

      if (fetchError) throw fetchError;

      const existingById = new Map(
        (existentes ?? []).map((e) => [Number(e.idoperador), e])
      );

      const nuevos = [];
      const actualizar = [];

      for (const row of batch) {
        const existente = existingById.get(Number(row.idoperador));
        if (existente) {
          actualizar.push({ row, existente });
        } else {
          nuevos.push(row);
        }
      }

      if (nuevos.length) {
        for (const row of nuevos) {
          const appRoleId = await resolverAppRoleIdPorRol(supabase, row.rol);
          const { administrador: _adm, ...insertRow } = row;
          const { error: insertError } = await supabase.from('operadores').insert({
            ...insertRow,
            app_role_id: appRoleId,
          });
          if (insertError) throw insertError;
        }
      }

      for (const { row, existente } of actualizar) {
        const rolExistente = String(existente.rol ?? '').toLowerCase();
        const rolFinal =
          rolExistente === 'superadmin'
            ? 'superadmin'
            : rolDesdeAdministradorQuantio(row.administrador);
        const appRoleId = await resolverAppRoleIdPorRol(supabase, rolFinal);

        const updatePayload = {
          operador: row.operador,
          nombrecompleto: row.nombrecompleto,
          codigo: row.codigo,
          activo: row.activo,
        };

        if (rolExistente !== 'superadmin') {
          updatePayload.rol = rolFinal;
          updatePayload.app_role_id = appRoleId;
        }

        const { error: updateError } = await supabase
          .from('operadores')
          .update(updatePayload)
          .eq('idoperador', row.idoperador)
          .eq('fuente', 'quantio');
        if (updateError) throw updateError;
      }

      syncUsuariosQuantioState.processed += batch.length;
      console.log(
        `✅ Lote usuarios Quantio #${batchNumber} — ${batch.length} (total ${syncUsuariosQuantioState.processed})`
      );

      if (rows.length < BATCH_SIZE) break;
    }

    await supabase
      .from('sync_status')
      .upsert({ key: 'usuarios_quantio', completed: true }, { onConflict: 'key' });

    syncUsuariosQuantioState.completed = true;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      processed: syncUsuariosQuantioState.processed,
      total: syncUsuariosQuantioState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync usuarios Quantio:', e);
    throw e;
  } finally {
    syncUsuariosQuantioState.inProgress = false;
  }
}

module.exports = { syncUsuariosQuantioToSupabase, syncUsuariosQuantioState, getQuantioPool };
