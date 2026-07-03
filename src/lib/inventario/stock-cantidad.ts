/** Límite inferior de cajas/unidades (stock de sistema puede ser negativo en Plex). */
export const MIN_STOCK_CANTIDAD = -6000;

export function esCantidadStockValida(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_STOCK_CANTIDAD;
}

export function mensajeCantidadStockInvalida(): string {
  return `Ingresá cantidades válidas (mínimo ${MIN_STOCK_CANTIDAD}).`;
}
