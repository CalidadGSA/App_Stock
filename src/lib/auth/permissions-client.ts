import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import { legacyPermissionsForRol } from '@/lib/auth/permissions-catalog';

export function clientHasPermission(
  permissions: string[] | undefined,
  rol: RolOperador | string | undefined,
  codigo: string,
): boolean {
  if (isSuperAdminRole(rol)) return true;
  const set =
    permissions && permissions.length > 0
      ? new Set(permissions)
      : legacyPermissionsForRol(rol);
  return set.has(codigo);
}

export function clientHasAdminAccess(
  permissions: string[] | undefined,
  rol: RolOperador | string | undefined,
): boolean {
  if (isSuperAdminRole(rol)) return true;
  const list =
    permissions && permissions.length > 0
      ? permissions
      : Array.from(legacyPermissionsForRol(rol));
  return list.some((p) => p.startsWith('admin.'));
}
