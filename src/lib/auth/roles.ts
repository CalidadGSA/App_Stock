export type RolOperador = 'superadmin' | 'admin' | 'operador_sucursal';

export function isAdminLikeRole(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'superadmin';
}

export function isSuperAdminRole(rol: string | null | undefined): boolean {
  return rol === 'superadmin';
}
