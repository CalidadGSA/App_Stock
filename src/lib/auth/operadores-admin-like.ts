import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdminLikeRole, isSuperAdminRole } from '@/lib/auth/roles';
import type { OperadorRbacContext } from '@/lib/auth/rbac';
import { isSuperAdminContext } from '@/lib/auth/rbac';

/** IDs de operadores con rol enum o app_role admin/superadmin. */
export async function idsOperadoresAdminLike(
  admin: SupabaseClient
): Promise<number[]> {
  const ids = new Set<number>();

  const { data: byRol, error: rolErr } = await admin
    .from('operadores')
    .select('idoperador')
    .in('rol', ['admin', 'superadmin']);

  if (rolErr) {
    console.warn('idsOperadoresAdminLike rol:', rolErr.message);
  } else {
    for (const row of byRol ?? []) {
      const id = Number((row as { idoperador: number }).idoperador);
      if (Number.isFinite(id)) ids.add(id);
    }
  }

  const { data: roles, error: rolesErr } = await admin
    .from('app_roles')
    .select('id')
    .in('codigo', ['admin', 'superadmin']);

  if (rolesErr) {
    console.warn('idsOperadoresAdminLike app_roles:', rolesErr.message);
  } else {
    const roleIds = (roles ?? [])
      .map((r) => Number((r as { id: number }).id))
      .filter((n) => Number.isFinite(n));
    if (roleIds.length > 0) {
      const { data: byAppRole, error: appErr } = await admin
        .from('operadores')
        .select('idoperador')
        .in('app_role_id', roleIds);
      if (appErr) {
        console.warn('idsOperadoresAdminLike app_role_id:', appErr.message);
      } else {
        for (const row of byAppRole ?? []) {
          const id = Number((row as { idoperador: number }).idoperador);
          if (Number.isFinite(id)) ids.add(id);
        }
      }
    }
  }

  return Array.from(ids);
}

/** Filtro PostgREST para `.not('usuario_id', 'in', ...)`. */
export function filtroUsuarioIds(ids: number[]): string | null {
  if (ids.length === 0) return null;
  return `(${ids.join(',')})`;
}

/** Operador de sucursal: no debe ver inventarios hechos por admin/superadmin. */
export function debeOcultarInventariosDeAdmin(ctx: OperadorRbacContext): boolean {
  if (isSuperAdminContext(ctx) || isSuperAdminRole(ctx.operador.rol)) return false;
  if (isAdminLikeRole(ctx.operador.rol)) return false;
  return true;
}

export function esUsuarioAdminLikeId(
  usuarioId: number | string | null | undefined,
  idsAdminLike: number[]
): boolean {
  const id = Number(usuarioId);
  if (!Number.isFinite(id)) return false;
  return idsAdminLike.includes(id);
}
