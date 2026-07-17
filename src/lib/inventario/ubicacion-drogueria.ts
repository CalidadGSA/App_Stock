export type UbicacionDrogueria = {
  sector: number | null;
  modulo: string | null;
  fila: number | null;
  posicion: number | null;
};

function valorUbicacion(v: number | string | null | undefined): string {
  if (v == null) return '-';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '-';
  }
  const t = String(v).trim();
  return t !== '' ? t : '-';
}

/** Siempre muestra los 4 campos; null/vacío → "-". */
export function formatearUbicacionDrogueria(u: UbicacionDrogueria | null | undefined): string {
  return [
    `Sector ${valorUbicacion(u?.sector)}`,
    `Módulo ${valorUbicacion(u?.modulo)}`,
    `Fila ${valorUbicacion(u?.fila)}`,
    `Posición ${valorUbicacion(u?.posicion)}`,
  ].join(' · ');
}
