/** Rango UTC para filtrar ajustes por fecha de cierre del control (no por fecha_inicio). */
export function rangoUtcAjustesInventario(desde: string, hasta: string) {
  return {
    desdeIso: `${desde}T00:00:00.000Z`,
    hastaIso: `${hasta}T23:59:59.999Z`,
  };
}
