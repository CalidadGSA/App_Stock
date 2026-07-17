import { getQuantioPool, isQuantioDatabaseConfigured } from '@/lib/legacy-db/quantio-mysql';
import type { RolOperador } from '@/lib/auth/roles';
import {
  resolverAppRoleIdPorRol,
  rolDesdeAdministradorQuantio,
  rolQuantioParaOperadorExistente,
} from '@/lib/auth/quantio-usuario-rol';
import {
  idOperadorQuantioDesdeLegacy,
  OPERADOR_FUENTE_QUANTIO,
} from '@/lib/sucursales/drogueria';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OperadorQuantioValidado = {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  codigo: number;
  activo: string;
  fuente: string;
  rol: RolOperador;
  administrador: boolean;
};

export type ValidacionQuantioResult =
  | { ok: true; operador: OperadorQuantioValidado }
  | {
      ok: false;
      reason: 'not_configured' | 'unreachable' | 'invalid_credentials';
      detail?: string;
    };

function normalizarActivo(valor: unknown): string {
  const v = String(valor ?? '').trim().toUpperCase();
  if (v === 'S' || v === '1' || v === 'T' || v === 'Y') return 'S';
  return 'N';
}

function mapRowQuantio(
  row: Record<string, unknown>,
  codigo: number
): OperadorQuantioValidado {
  const nombre = String(row.Nombre ?? '').trim().toUpperCase();
  const nombreCompleto = String(row.NombreCompleto ?? nombre).trim() || nombre;
  const rol = rolDesdeAdministradorQuantio(row.Administrador);

  return {
    idoperador: idOperadorQuantioDesdeLegacy(Number(row.IDUsuario)),
    operador: nombre,
    nombrecompleto: nombreCompleto,
    codigo,
    activo: normalizarActivo(row.Activo),
    fuente: OPERADOR_FUENTE_QUANTIO,
    rol,
    administrador: rol === 'admin',
  };
}

/** Auth live contra MySQL Quantio. Distingue config/red de credenciales inválidas. */
export async function validarOperadorQuantioLive(
  operador: string,
  codigo: number
): Promise<ValidacionQuantioResult> {
  if (!isQuantioDatabaseConfigured()) {
    console.warn('validarOperadorQuantioLive: QUANTIO_DB_* no configurado');
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const pool = getQuantioPool();
    const [rows] = await pool.query(
      `
        SELECT IDUsuario, Nombre, NombreCompleto, Codigo, Activo, Administrador
        FROM usuarios
        WHERE UPPER(TRIM(Nombre)) = ? AND Codigo = ?
        LIMIT 1
      `,
      [operador, codigo]
    );

    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return { ok: false, reason: 'invalid_credentials' };

    const mapped = mapRowQuantio(row, codigo);
    if (mapped.activo !== 'S') return { ok: false, reason: 'invalid_credentials' };

    return { ok: true, operador: mapped };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('validarOperadorQuantioLive:', detail);
    return { ok: false, reason: 'unreachable', detail };
  }
}

/** Fallback: operadores ya sincronizados a Supabase (fuente=quantio). */
export async function validarOperadorQuantioEnSupabase(
  admin: SupabaseClient,
  operador: string,
  codigo: number
): Promise<OperadorQuantioValidado | null> {
  const { data, error } = await admin
    .from('operadores')
    .select('idoperador, operador, nombrecompleto, codigo, activo, rol, fuente')
    .eq('fuente', OPERADOR_FUENTE_QUANTIO)
    .eq('operador', operador)
    .eq('codigo', codigo)
    .eq('activo', 'S')
    .maybeSingle();

  if (error) {
    if (error.message?.includes('fuente')) {
      return null;
    }
    console.warn('validarOperadorQuantioEnSupabase:', error.message);
    return null;
  }
  if (!data) return null;

  const rol = (String(data.rol ?? 'operador_sucursal').toLowerCase() === 'admin'
    ? 'admin'
    : String(data.rol ?? '').toLowerCase() === 'superadmin'
      ? 'superadmin'
      : 'operador_sucursal') as RolOperador;

  return {
    idoperador: Number(data.idoperador),
    operador: String(data.operador),
    nombrecompleto: String(data.nombrecompleto ?? data.operador),
    codigo,
    activo: 'S',
    fuente: OPERADOR_FUENTE_QUANTIO,
    rol,
    administrador: rol === 'admin',
  };
}

export async function upsertOperadorQuantioEnSupabase(
  admin: SupabaseClient,
  op: OperadorQuantioValidado
): Promise<{ rol: RolOperador; app_role_id: number | null }> {
  const { data: existente } = await admin
    .from('operadores')
    .select('idoperador, rol')
    .eq('idoperador', op.idoperador)
    .maybeSingle();

  const rolFinal = existente
    ? rolQuantioParaOperadorExistente(
        (existente as { rol?: string }).rol,
        op.administrador ? 'S' : 'N'
      )
    : op.rol;

  const appRoleId = await resolverAppRoleIdPorRol(admin, rolFinal);

  if (existente) {
    const updatePayload: Record<string, unknown> = {
      operador: op.operador,
      nombrecompleto: op.nombrecompleto,
      codigo: op.codigo,
      activo: op.activo,
    };

    if (String((existente as { rol?: string }).rol ?? '').toLowerCase() !== 'superadmin') {
      updatePayload.rol = rolFinal;
      updatePayload.app_role_id = appRoleId;
    }

    await admin
      .from('operadores')
      .update(updatePayload)
      .eq('idoperador', op.idoperador)
      .eq('fuente', OPERADOR_FUENTE_QUANTIO);

    return {
      rol: String((existente as { rol?: string }).rol ?? '').toLowerCase() === 'superadmin'
        ? 'superadmin'
        : rolFinal,
      app_role_id: appRoleId,
    };
  }

  await admin.from('operadores').insert({
    idoperador: op.idoperador,
    operador: op.operador,
    nombrecompleto: op.nombrecompleto,
    codigo: op.codigo,
    activo: op.activo,
    fuente: OPERADOR_FUENTE_QUANTIO,
    rol: rolFinal,
    app_role_id: appRoleId,
  });

  return { rol: rolFinal, app_role_id: appRoleId };
}
