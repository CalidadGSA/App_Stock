export type RolOperador = 'superadmin' | 'admin' | 'operador_sucursal';

export function isAdminLikeRole(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'superadmin';
}

export function isSuperAdminRole(rol: string | null | undefined): boolean {
  return rol === 'superadmin';
}

/** Puede ingresar y permanecer en la app con modo mantenimiento activo. */
export function canBypassMaintenance(rol: string | null | undefined): boolean {
  return isAdminLikeRole(rol);
}
