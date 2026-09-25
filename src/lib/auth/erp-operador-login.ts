/**
 * Validación de credenciales del operador contra el ERP **en vivo**:
 *
 *  - Droguería Marrone → `plexdr.usuarios` (Quantio).
 *  - Resto de las sucursales → `onze_center.operadores`.
 *
 * La tabla `operadores` de Supabase sigue existiendo, pero ya no decide quién entra: guarda los
 * datos propios de la app (rol, app_role_id, session_version) y es el destino de las claves
 * foráneas de controles, ajustes y devoluciones. Tras validar contra el ERP se hace upsert de
 * los datos de identidad, conservando siempre lo que administra la app.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import { conTimeout } from '@/lib/legacy-db/ventas-legacy-types';
import { OPERADOR_FUENTE_ONZE } from '@/lib/sucursales/drogueria';
import type { RolOperador } from '@/lib/auth/roles';
import { resolverAppRoleIdPorRol } from '@/lib/auth/quantio-usuario-rol';

const DEFAULT_TIMEOUT_MS = 10_000;

function timeoutMs(): number {
  const n = parseInt(process.env.ONZE_LOGIN_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export type OperadorErpValidado = {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  codigo: number;
  /** 'S' | 'N' tal como lo informa el ERP. */
  activo: string;
  administrador: boolean;
};

export type ValidacionErpResult =
  | { ok: true; operador: OperadorErpValidado }
  | { ok: false; reason: 'not_configured' | 'unreachable' | 'invalid_credentials'; detail?: string };

function normalizarSN(valor: unknown): string {
  const v = String(valor ?? '').trim().toUpperCase();
  return v === 'S' || v === '1' || v === 'T' || v === 'Y' ? 'S' : 'N';
}

/** Credenciales contra `onze_center.operadores` (operador + código). */
export async function validarOperadorOnzeLive(
  operador: string,
  codigo: number
): Promise<ValidacionErpResult> {
  try {
    const pool = await getOnzePool();
    if (!pool) return { ok: false, reason: 'not_configured' };

    const consulta = pool.query(
      // Hay nombres repetidos en el ERP (recontrataciones), pero nunca con el mismo código:
      // aun así se ordena para que gane el activo y el alta más reciente.
      `SELECT IDOperador, Operador, NombreCompleto, Codigo, Activo, Administrador
       FROM operadores
       WHERE UPPER(TRIM(Operador)) = ? AND Codigo = ?
       ORDER BY (UPPER(TRIM(Activo)) = 'S') DESC, IDOperador DESC
       LIMIT 1`,
      [operador.trim().toUpperCase(), codigo]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(consulta, timeoutMs(), 'Onze login operador');

    const row = rows[0];
    if (!row) return { ok: false, reason: 'invalid_credentials' };

    const activo = normalizarSN(row.Activo);
    if (activo !== 'S') return { ok: false, reason: 'invalid_credentials' };

    const nombre = String(row.Operador ?? '').trim().toUpperCase();
    return {
      ok: true,
      operador: {
        idoperador: Number(row.IDOperador),
        operador: nombre,
        nombrecompleto: String(row.NombreCompleto ?? '').trim() || nombre,
        codigo,
        activo,
        administrador: normalizarSN(row.Administrador) === 'S',
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('validarOperadorOnzeLive:', detail);
    return { ok: false, reason: 'unreachable', detail };
  }
}

export type DatosSesionOperador = {
  rol: RolOperador;
  app_role_id: number | null;
  session_version: number;
};

/**
 * Deja el operador del ERP en `operadores` (Supabase) y devuelve lo que la app administra.
 * Nunca pisa el rol ni el rol de app: los permisos se asignan desde la pantalla de roles.
 * Un operador nuevo entra con el rol mínimo (`operador_sucursal`).
 */
/**
 * Nombre de login libre para un operador nuevo: si otro legajo ya ocupa ese nombre en la misma
 * fuente, el nuevo entra como `nombre__ex<id>`, igual que la sincronización de operadores.
 */
async function nombreLoginDisponible(
  admin: SupabaseClient,
  op: OperadorErpValidado,
  fuente: string
): Promise<string> {
  const { data } = await admin
    .from('operadores')
    .select('idoperador')
    .eq('fuente', fuente)
    .eq('operador', op.operador)
    .neq('idoperador', op.idoperador)
    .maybeSingle();
  return data ? `${op.operador}__ex${op.idoperador}` : op.operador;
}

export async function upsertOperadorErpEnSupabase(
  admin: SupabaseClient,
  op: OperadorErpValidado,
  fuente: string = OPERADOR_FUENTE_ONZE
): Promise<DatosSesionOperador> {
  const { data: existente } = await admin
    .from('operadores')
    .select('rol, app_role_id, session_version')
    .eq('idoperador', op.idoperador)
    .maybeSingle();

  const fila = existente as
    | { rol?: string | null; app_role_id?: number | null; session_version?: number | null }
    | null;

  const rol = (String(fila?.rol ?? '').trim() || 'operador_sucursal') as RolOperador;
  const sessionVersion = Number(fila?.session_version ?? 0) || 0;
  const appRoleId = fila?.app_role_id ?? (await resolverAppRoleIdPorRol(admin, rol));

  if (fila) {
    // `operador` no se toca: la sincronización de operadores renombra a `nombre__ex<id>` al
    // perdedor cuando dos legajos comparten nombre, y pisarlo rompería el único (operador, fuente).
    const { error } = await admin
      .from('operadores')
      .update({
        nombrecompleto: op.nombrecompleto,
        codigo: op.codigo,
        activo: op.activo,
      })
      .eq('idoperador', op.idoperador);
    if (error) console.warn('upsertOperadorErpEnSupabase (update):', error.message);
    return { rol, app_role_id: appRoleId, session_version: sessionVersion };
  }

  const { error } = await admin.from('operadores').insert({
    idoperador: op.idoperador,
    operador: await nombreLoginDisponible(admin, op, fuente),
    nombrecompleto: op.nombrecompleto,
    codigo: op.codigo,
    activo: op.activo,
    fuente,
    rol,
    app_role_id: appRoleId,
  });
  if (error) {
    // El login no debe caerse porque no se pudo espejar el operador.
    console.warn('upsertOperadorErpEnSupabase (insert):', error.message);
  }

  return { rol, app_role_id: appRoleId, session_version: sessionVersion };
}
