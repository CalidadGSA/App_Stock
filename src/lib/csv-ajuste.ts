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

export type OpcionesCsvAjuste = {
  /** Droguería: solo cajas; el sistema destino no acepta columna de unidades. */
  omitirUnidades?: boolean;
};

const CABECERA_IMPORT = [
  'idproducto',
  'codigo_barras',
  'diferencia_cajas',
  'diferencia_unidades',
];

const CABECERA_IMPORT_SIN_UNIDADES = [
  'idproducto',
  'codigo_barras',
  'diferencia_cajas',
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
  formato: FormatoCsvAjuste,
  opts?: OpcionesCsvAjuste
): string {
  const omitirUnidades = Boolean(opts?.omitirUnidades);

  if (formato === 'gsa') {
    const sep = ';';
    const lineas = filas.map((r) => {
      const cols = [
        campoGsa(r.idproducto ?? '', sep),
        campoGsa(r.codigo_barras ?? '', sep),
        campoGsa(String(Math.trunc(Number(r.diferencia_cajas) || 0)), sep),
      ];
      if (!omitirUnidades) {
        cols.push(campoGsa(String(Math.trunc(Number(r.diferencia_unidades) || 0)), sep));
      }
      return cols.join(sep);
    });
    const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
    return cuerpo;
  }

  if (formato === 'legacy') {
    const sep = ',';
    const lineas = filas.map((r) => {
      const cols = [
        campoEntreComillas(r.idproducto ?? ''),
        campoEntreComillas(r.codigo_barras ?? ''),
        campoEntreComillas(String(r.diferencia_cajas ?? 0)),
      ];
      if (!omitirUnidades) {
        cols.push(campoEntreComillas(String(r.diferencia_unidades ?? 0)));
      }
      return cols.join(sep);
    });
    const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
    return cuerpo;
  }

  // import: BOM + cabecera + ; + comillas
  const sep = ';';
  const cabecera = omitirUnidades ? CABECERA_IMPORT_SIN_UNIDADES : CABECERA_IMPORT;
  const lineas: string[] = [cabecera.join(sep)];
  for (const r of filas) {
    const cols = [
      campoEntreComillas(r.idproducto ?? ''),
      campoEntreComillas(r.codigo_barras ?? ''),
      campoEntreComillas(String(r.diferencia_cajas ?? 0)),
    ];
    if (!omitirUnidades) {
      cols.push(campoEntreComillas(String(r.diferencia_unidades ?? 0)));
    }
    lineas.push(cols.join(sep));
  }
  const cuerpo = lineas.join('\n') + (lineas.length > 0 ? '\n' : '');
  return `\uFEFF${cuerpo}`;
}
