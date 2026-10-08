import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import {
  leerOperadorSessionCookie,
  leerOperadorSessionRow,
  sessionVersionCoincideConDb,
  type OperadorSession,
  type OperadorSessionDbRow,
} from '@/lib/auth/session';
import { isAdminLikeRole, isSuperAdminRole, type RolOperador } from '@/lib/auth/roles';
import {
  ALL_PERMISSION_CODES,
  legacyPermissionsForRol,
} from '@/lib/auth/permissions-catalog';
import { NextResponse } from 'next/server';

export interface AppRoleRow {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  rol_legacy: RolOperador;
  es_sistema: boolean;
  activo: boolean;
}

export interface OperadorRbacContext {
  operador: OperadorSession;
  appRoleId: number | null;
  appRoleCodigo: string | null;
  permissions: Set<string>;
}

/** Superadmin: acceso total (enum en sesión/BD o rol app superadmin). */
export function isSuperAdminContext(ctx: OperadorRbacContext): boolean {
  return isSuperAdminRole(ctx.operador.rol) || ctx.appRoleCodigo === 'superadmin';
}

type AppRoleConPermisos = {
  id: number;
  codigo: string;
  activo: boolean;
  app_role_permissions: Array<{ permission_codigo: string }> | null;
};

/**
 * Suma y resta los permisos cargados para ese operador en particular (`operador_permisos`).
 * Permite darle acceso a un módulo suelto, o sacárselo, sin tener que cambiarle el rol.
 *
 * Si la tabla todavía no existe (migración 034 sin aplicar) no hace nada.
 */
async function aplicarAjustesDelOperador(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  idoperador: number,
  permissions: Set<string>,
): Promise<void> {
  const { data, error } = await admin
    .from('operador_permisos')
    .select('permission_codigo, concedido')
    .eq('idoperador', idoperador);

  if (error) {
    if (!/operador_permisos|schema cache|does not exist/i.test(error.message)) {
      console.warn('rbac: no se pudieron leer los permisos del operador:', error.message);
    }
    return;
  }

  for (const row of (data ?? []) as Array<{ permission_codigo: string; concedido: boolean }>) {
    const codigo = String(row.permission_codigo);
    if (row.concedido) permissions.add(codigo);
    else permissions.delete(codigo);
  }
}

async function loadPermissionsForOperador(
  idoperador: number,
  rolEnum: RolOperador | undefined,
  opRowPrecargada?: OperadorSessionDbRow | null,
): Promise<{
  rolDb: RolOperador;
  appRoleId: number | null;
  appRoleCodigo: string | null;
  permissions: Set<string>;
}> {
  const fallbackRol = (rolEnum ?? 'operador_sucursal') as RolOperador;
  const vacio = (rolDb: RolOperador) => ({
    rolDb,
    appRoleId: null,
    appRoleCodigo: null,
    permissions: new Set<string>(),
  });

  try {
    const admin = await createAdminClient();
    const opRow =
      opRowPrecargada !== undefined ? opRowPrecargada : await leerOperadorSessionRow(idoperador);

    if (!opRow) return vacio(fallbackRol);

    const rolDb = (opRow.rol ?? fallbackRol) as RolOperador;
    let roleId = opRow.app_role_id;

    const selectRol = 'id, codigo, activo, app_role_permissions(permission_codigo)';

    // Superadmin y operadores sin rol app: resolver el rol de sistema por código.
    let role: AppRoleConPermisos | null = null;
    if (rolDb === 'superadmin' || !roleId) {
      const { data: sysRole } = await admin
        .from('app_roles')
        .select(selectRol)
        .eq('codigo', rolDb)
        .maybeSingle();
      role = (sysRole as AppRoleConPermisos | null) ?? null;
      if (rolDb === 'superadmin' && role?.id && opRow.app_role_id !== role.id) {
        // Mantener operadores.app_role_id alineado (solo la primera vez que se detecta desfase).
        const { error: alignErr } = await admin
          .from('operadores')
          .update({ app_role_id: role.id })
          .eq('idoperador', idoperador);
        if (alignErr) console.warn('rbac: no se pudo alinear app_role_id superadmin', alignErr.message);
      }
      roleId = role?.id ?? null;
    } else {
      const { data } = await admin.from('app_roles').select(selectRol).eq('id', roleId).maybeSingle();
      role = (data as AppRoleConPermisos | null) ?? null;
    }

    if (!roleId || !role || !role.activo) return vacio(rolDb);

    const permissions = new Set(
      (role.app_role_permissions ?? []).map((p) => String(p.permission_codigo)),
    );

    await aplicarAjustesDelOperador(admin, idoperador, permissions);

    return {
      rolDb,
      appRoleId: Number(role.id),
      appRoleCodigo: String(role.codigo),
      permissions,
    };
  } catch {
    return vacio(fallbackRol);
  }
}

/**
 * Contexto RBAC del operador autenticado (consulta BD; rol de BD tiene prioridad sobre cookie).
 * Valida session_version con la misma lectura de `operadores` que usa para el rol
 * (una consulta menos por request que llamar además a getOperadorSession).
 */
export const getOperadorRbacContext = cache(async (): Promise<OperadorRbacContext | null> => {
  const operador = await leerOperadorSessionCookie();
  if (!operador) return null;

  const opRow = await leerOperadorSessionRow(operador.idoperador);
  if (!sessionVersionCoincideConDb(operador, opRow?.session_version)) return null;

  const loaded = await loadPermissionsForOperador(operador.idoperador, operador.rol, opRow);

  const operadorActualizado: OperadorSession = {
    ...operador,
    rol: loaded.rolDb,
  };

  return {
    operador: operadorActualizado,
    appRoleId: loaded.appRoleId,
    appRoleCodigo: loaded.appRoleCodigo,
    permissions: loaded.permissions,
  };
});

function effectivePermissions(ctx: OperadorRbacContext): Set<string> {
  return effectivePermissionsForRole(
    ctx.operador.rol ?? 'operador_sucursal',
    ctx.appRoleCodigo,
    ctx.permissions,
  );
}

/** Permisos efectivos de un operador (rol app + fallback legacy + superadmin). */
export function effectivePermissionsForRole(
  rolDb: RolOperador,
  appRoleCodigo: string | null,
  rolePermissions: Set<string>,
): Set<string> {
  if (isSuperAdminRole(rolDb) || appRoleCodigo === 'superadmin') {
    return new Set(ALL_PERMISSION_CODES);
  }
  if (rolePermissions.size > 0) return rolePermissions;
  return legacyPermissionsForRol(rolDb);
}

/** Carga permisos efectivos de un operador desde BD (para listados admin). */
export async function loadEffectivePermissionsForOperador(
  idoperador: number,
  rolEnum?: RolOperador,
): Promise<Set<string>> {
  const loaded = await loadPermissionsForOperador(idoperador, rolEnum);
  return effectivePermissionsForRole(loaded.rolDb, loaded.appRoleCodigo, loaded.permissions);
}

export function hasPermission(ctx: OperadorRbacContext, codigo: string): boolean {
  if (isSuperAdminContext(ctx)) return true;
  return effectivePermissions(ctx).has(codigo);
}

export function hasAnyPermission(ctx: OperadorRbacContext, codigos: string[]): boolean {
  if (isSuperAdminContext(ctx)) return true;
  return codigos.some((c) => hasPermission(ctx, c));
}

/** Ve todos los tipos de inventario (auditoría, ocasional auditoría, etc.). */
export function canSeeAllInventarioTipos(ctx: OperadorRbacContext): boolean {
  if (isSuperAdminContext(ctx)) return true;
  return (
    hasPermission(ctx, 'inventario.auditoria') ||
    hasPermission(ctx, 'admin.ajustes') ||
    hasPermission(ctx, 'admin.resumen_trimestral')
  );
}

export function hasAdminAccess(ctx: OperadorRbacContext): boolean {
  if (isSuperAdminContext(ctx)) return true;
  if (isAdminLikeRole(ctx.operador.rol) && ctx.permissions.size === 0) return true;
  for (const p of effectivePermissions(ctx)) {
    if (p.startsWith('admin.')) return true;
  }
  return false;
}

/** Permisos serializables para el cliente (nav, páginas). */
export function permissionsToArray(ctx: OperadorRbacContext): string[] {
  return Array.from(effectivePermissions(ctx));
}

export type RbacGuardResult =
  | { ok: true; ctx: OperadorRbacContext }
  | { ok: false; response: NextResponse };

/** Requiere admin o superadmin (enum legacy o permisos admin.*). */
export async function requireAdminRbac(): Promise<RbacGuardResult> {
  const ctx = await getOperadorRbacContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  }
  if (!hasAdminAccess(ctx)) {
    return { ok: false, response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

/** Requiere al menos uno de los permisos indicados. */
export async function requireAnyPermission(codigos: string[]): Promise<RbacGuardResult> {
  const ctx = await getOperadorRbacContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  }
  if (!hasAnyPermission(ctx, codigos)) {
    return { ok: false, response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

/** Requiere un permiso concreto. */
export async function requirePermission(codigo: string): Promise<RbacGuardResult> {
  const ctx = await getOperadorRbacContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  }
  if (!hasPermission(ctx, codigo)) {
    return { ok: false, response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

/** Requiere permiso específico de gestión de roles. */
export async function requireRolesManageRbac(): Promise<RbacGuardResult> {
  const guard = await requirePermission('admin.roles_manage');
  return guard;
}

/** Solo superadmin puede asignar o editar el rol superadmin. */
export function canManageSuperadminRole(ctx: OperadorRbacContext): boolean {
  return isSuperAdminContext(ctx);
}
