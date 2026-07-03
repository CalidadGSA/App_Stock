import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession, type OperadorSession } from '@/lib/auth/session';
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

async function loadPermissionsForOperador(
  idoperador: number,
  rolEnum: RolOperador | undefined,
): Promise<{
  rolDb: RolOperador;
  appRoleId: number | null;
  appRoleCodigo: string | null;
  permissions: Set<string>;
}> {
  const fallbackRol = (rolEnum ?? 'operador_sucursal') as RolOperador;

  try {
    const admin = await createAdminClient();
    const { data: opRow, error: opErr } = await admin
      .from('operadores')
      .select('app_role_id, rol')
      .eq('idoperador', idoperador)
      .maybeSingle();

    if (opErr) {
      return {
        rolDb: fallbackRol,
        appRoleId: null,
        appRoleCodigo: null,
        permissions: new Set(),
      };
    }

    const rolDb = (opRow?.rol ?? fallbackRol) as RolOperador;
    let roleId = opRow?.app_role_id as number | null | undefined;

    if (rolDb === 'superadmin') {
      const { data: sysRole } = await admin
        .from('app_roles')
        .select('id, codigo')
        .eq('codigo', 'superadmin')
        .maybeSingle();
      if (sysRole?.id) {
        roleId = sysRole.id as number;
        if (opRow?.app_role_id !== roleId) {
          await admin
            .from('operadores')
            .update({ app_role_id: roleId })
            .eq('idoperador', idoperador);
        }
      }
    } else if (!roleId) {
      const { data: sysRole } = await admin
        .from('app_roles')
        .select('id, codigo')
        .eq('codigo', rolDb)
        .maybeSingle();
      roleId = sysRole?.id ?? null;
    }

    if (!roleId) {
      return { rolDb, appRoleId: null, appRoleCodigo: null, permissions: new Set() };
    }

    const { data: role } = await admin
      .from('app_roles')
      .select('id, codigo, activo')
      .eq('id', roleId)
      .maybeSingle();

    if (!role || !role.activo) {
      return { rolDb, appRoleId: null, appRoleCodigo: null, permissions: new Set() };
    }

    const { data: perms } = await admin
      .from('app_role_permissions')
      .select('permission_codigo')
      .eq('role_id', roleId);

    const permissions = new Set(
      (perms ?? []).map((p) => String(p.permission_codigo)),
    );

    return {
      rolDb,
      appRoleId: role.id as number,
      appRoleCodigo: role.codigo as string,
      permissions,
    };
  } catch {
    return {
      rolDb: fallbackRol,
      appRoleId: null,
      appRoleCodigo: null,
      permissions: new Set(),
    };
  }
}

/** Contexto RBAC del operador autenticado (consulta BD; rol de BD tiene prioridad sobre cookie). */
export async function getOperadorRbacContext(): Promise<OperadorRbacContext | null> {
  const operador = await getOperadorSession();
  if (!operador) return null;

  const loaded = await loadPermissionsForOperador(operador.idoperador, operador.rol);

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
}

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
