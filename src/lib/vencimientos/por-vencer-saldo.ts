/** Saldo pendiente en la línea (no liquidada: restante > 0 y sin flag vendido). */
export function esLineaSinLiquidar(
  cantidad: number | undefined | null,
  vendido: number | undefined | null
): boolean {
  if (Number(vendido ?? 0) === 1) return false;
  const cant = Number(cantidad ?? 0);
  return Number.isFinite(cant) && cant > 0;
}
