/**
 * Reglas de unidades sueltas en inventario.
 * Alineado con PATCH /api/inventario/[id]/detalles: sin dato de padrón → no bloquear.
 */

export function parseFraccionableValor(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const s = String(raw).trim().toUpperCase();
  if (s === 'S' || s === 'SI' || s === 'Y' || s === 'TRUE') return 1;
  if (s === 'N' || s === 'NO' || s === 'FALSE') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** true si el producto admite contar unidades sueltas (legacy: 1 = sí). */
export function esProductoFraccionable(fraccionable: number | undefined | null): boolean {
  if (fraccionable == null) return true;
  const n = Number(fraccionable);
  if (!Number.isFinite(n)) return true;
  return n === 1;
}

/**
 * Bloquea el campo de unidades cuando no es fraccionable y el sistema no tiene unidades sueltas.
 * Si ya hay unidades en stock legacy, se permite corregir ese saldo.
 */
export function bloquearCampoUnidadesInventario(
  fraccionable: number | undefined | null,
  stockUnidadesSistema: number | undefined | null
): boolean {
  if (esProductoFraccionable(fraccionable)) return false;
  return (stockUnidadesSistema ?? 0) === 0;
}
