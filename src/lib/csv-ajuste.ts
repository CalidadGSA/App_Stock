/** Filas del CSV de ajustes (diferencias cajas/unidades). */
export type FilaCsvAjuste = {
  idproducto: string;
  codigo_barras: string;
  diferencia_cajas: number;
  diferencia_unidades: number;
};

/**
 * - `gsa`: formato que acepta el ERP (punto y coma, sin cabecera, sin BOM, campos sin comillas si no hace falta).
 * - `import`: UTF-8 con BOM, `;`, cabecera y campos entre comillas (Excel / otras integraciones).
 * - `legacy`: coma y comillas como el export histórico de la app.
 */
export type FormatoCsvAjuste = 'gsa' | 'import' | 'legacy';

const CABECERA_IMPORT = [
  'idproducto',
  'codigo_barras',
  'diferencia_cajas',
  'diferencia_unidades',
];

function campoEntreComillas(valor: string): string {
  return `"${String(valor).replace(/"/g, '""')}"`;
}

/** Campo tipo archivo GSA: sin comillas salvo que contenga `;`, comillas o salto de línea. */
function campoGsa(valor: string, separador: string): string {
  const s = String(valor);
  const esc = s.replace(/"/g, '""');
  if (
    s.includes(separador) ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return `"${esc}"`;
  }
  return s;
}

/**
 * Serializa diferencias para import.
 * Por defecto en rutas API se usa `gsa` (coincide con plantilla aceptada por el sistema).
 */
export function serializarCsvAjuste(
  filas: FilaCsvAjuste[],
  formato: FormatoCsvAjuste
): string {
  if (formato === 'gsa') {
    const sep = ';';
    const lineas = filas.map((r) =>
      [
        campoGsa(r.idproducto ?? '', sep),
        campoGsa(r.codigo_barras ?? '', sep),
        campoGsa(String(Math.trunc(Number(r.diferencia_cajas) || 0)), sep),
        campoGsa(String(Math.trunc(Number(r.diferencia_unidades) || 0)), sep),
      ].join(sep)
    );
    const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
    return cuerpo;
  }

  if (formato === 'legacy') {
    const sep = ',';
    const lineas = filas.map((r) =>
      [
        campoEntreComillas(r.idproducto ?? ''),
        campoEntreComillas(r.codigo_barras ?? ''),
        campoEntreComillas(String(r.diferencia_cajas ?? 0)),
        campoEntreComillas(String(r.diferencia_unidades ?? 0)),
      ].join(sep)
    );
    const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
    return cuerpo;
  }

  // import: BOM + cabecera + ; + comillas
  const sep = ';';
  const lineas: string[] = [CABECERA_IMPORT.join(sep)];
  for (const r of filas) {
    lineas.push(
      [
        campoEntreComillas(r.idproducto ?? ''),
        campoEntreComillas(r.codigo_barras ?? ''),
        campoEntreComillas(String(r.diferencia_cajas ?? 0)),
        campoEntreComillas(String(r.diferencia_unidades ?? 0)),
      ].join(sep)
    );
  }
  const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
  return `\uFEFF${cuerpo}`;
}
