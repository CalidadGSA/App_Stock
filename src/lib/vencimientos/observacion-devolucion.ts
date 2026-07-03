/** Umbral: si vendido &lt; 50 % de la carga original, la observación es obligatoria al devolver. */
export const UMBRAL_RATIO_VENDIDO_OBSERVACION_DEVOLUCION = 0.5;

export function ratioVendidoSobreOriginal(
  cantidadRestante: number,
  cantidadVendidaAcumulada: number
): number | null {
  const rest = Number(cantidadRestante) || 0;
  const vend = Number(cantidadVendidaAcumulada) || 0;
  const orig = rest + vend;
  if (orig <= 0) return null;
  return Math.min(1, vend / orig);
}

export function obligatorioObservacionDevolucion(
  cantidadCargadaOriginal: number,
  cantidadVendidaAcumulada: number
): boolean {
  const orig = Number(cantidadCargadaOriginal) || 0;
  if (orig <= 0) return false;
  const vend = Number(cantidadVendidaAcumulada) || 0;
  return vend / orig < UMBRAL_RATIO_VENDIDO_OBSERVACION_DEVOLUCION;
}

export function tieneObservacionDevolucion(texto: string | null | undefined): boolean {
  return String(texto ?? '').trim().length > 0;
}
