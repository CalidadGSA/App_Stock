/**
 * Sucursales que no aparecen en el login ni en vistas operativas de la red.
 * Mantener sincronizado con /api/auth/sucursales.
 */
export const SUCURSALES_EXCLUIDAS_LOGIN: readonly number[] = [9, 10, 15, 18];

/** Filtro PostgREST para `.not('sucursal', 'in', ...)`. */
export function filtroSucursalesExcluidasLogin(): string {
  return `(${SUCURSALES_EXCLUIDAS_LOGIN.join(',')})`;
}

export function esSucursalVisibleEnLogin(sucursalId: number): boolean {
  return !SUCURSALES_EXCLUIDAS_LOGIN.includes(sucursalId);
}

/** Filtra filas de sucursales (p. ej. tras consulta a `sucursales`). */
export function filtrarSucursalesVisiblesLogin<T extends { sucursal: number }>(
  rows: T[] | null | undefined
): T[] {
  return (rows ?? []).filter((r) => esSucursalVisibleEnLogin(Number(r.sucursal)));
}
