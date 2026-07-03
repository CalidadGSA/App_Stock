/** Máximo de cajas en stock real (inventario). */
export const MAX_STOCK_REAL_CAJAS = 6000;

/** Máximo de unidades sueltas en stock real (inventario). */
export const MAX_STOCK_REAL_UNIDADES = 1000;

export function mensajeMaxStockRealUnidades(): string {
  return `El stock físico en unidades no puede ser mayor a ${MAX_STOCK_REAL_UNIDADES}.`;
}

export function mensajeMaxStockRealCajas(): string {
  return `El stock físico en cajas no puede ser mayor a ${MAX_STOCK_REAL_CAJAS}.`;
}
