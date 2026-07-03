/**
 * Extrae IDs de producto (codplex) desde CSV o texto pegado.
 * Acepta una columna o varias; detecta cabecera opcional (codplex, id, idproducto…).
 */
const HEADER_ALIASES = new Set([
  'codplex',
  'cod_plex',
  'id',
  'idproducto',
  'id_producto',
  'producto_id',
  'producto_id_sistema',
  'codigo',
  'cod',
]);

function normalizarCelda(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function parsearLineaCsv(linea: string): string[] {
  const out: string[] = [];
  let actual = '';
  let enComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        enComillas = !enComillas;
      }
      continue;
    }
    if ((ch === ',' || ch === ';') && !enComillas) {
      out.push(normalizarCelda(actual));
      actual = '';
      continue;
    }
    actual += ch;
  }
  out.push(normalizarCelda(actual));
  return out;
}

function esIdProducto(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  return /^\d+$/.test(t);
}

function indiceColumnaId(celdas: string[]): number {
  for (let i = 0; i < celdas.length; i++) {
    const key = celdas[i].toLowerCase().replace(/\s+/g, '_');
    if (HEADER_ALIASES.has(key)) return i;
  }
  return 0;
}

export type ParseCsvProductosResult = {
  ids: string[];
  duplicadosOmitidos: number;
  filasVacias: number;
  filasInvalidas: number;
};

export function parseCsvProductoIds(contenido: string): ParseCsvProductosResult {
  const lineas = contenido
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) {
    return { ids: [], duplicadosOmitidos: 0, filasVacias: 0, filasInvalidas: 0 };
  }

  const primera = parsearLineaCsv(lineas[0]);
  const primeraLower = primera.map((c) => c.toLowerCase().replace(/\s+/g, '_'));
  const tieneCabecera = primeraLower.some((c) => HEADER_ALIASES.has(c));
  const colId = tieneCabecera ? indiceColumnaId(primera) : 0;
  const inicio = tieneCabecera ? 1 : 0;

  const vistos = new Set<string>();
  const ids: string[] = [];
  let duplicadosOmitidos = 0;
  let filasVacias = 0;
  let filasInvalidas = 0;

  for (let i = inicio; i < lineas.length; i++) {
    const celdas = parsearLineaCsv(lineas[i]);
    const raw = celdas[colId] ?? celdas[0] ?? '';
    if (!raw) {
      filasVacias++;
      continue;
    }
    if (!esIdProducto(raw)) {
      filasInvalidas++;
      continue;
    }
    const id = String(parseInt(raw, 10));
    if (vistos.has(id)) {
      duplicadosOmitidos++;
      continue;
    }
    vistos.add(id);
    ids.push(id);
  }

  return { ids, duplicadosOmitidos, filasVacias, filasInvalidas };
}
