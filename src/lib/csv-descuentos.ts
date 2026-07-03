/** Fila del CSV de descuentos por vencimiento (import Plex / GSA). */
export type FilaCsvDescuento = {
  codigo_barras: string;
  descuento: number;
  cantidad: number;
};

const SEP = ';';

function campo(valor: string): string {
  const s = String(valor);
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Punto y coma, sin cabecera ni BOM (mismo criterio que ajustes formato `gsa`). */
export function serializarCsvDescuentos(filas: FilaCsvDescuento[]): string {
  const lineas = filas.map((r) =>
    [
      campo(r.codigo_barras ?? ''),
      campo(String(Math.round(Number(r.descuento) || 0))),
      campo(String(Math.round(Number(r.cantidad) || 0))),
    ].join(SEP)
  );
  return lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
}
