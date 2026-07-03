export const CATEGORIAS_MACRO = ['FARMA', 'BIENESTAR', 'PSICOTROPICOS'] as const;

/** Valor canónico en controles_inventario.categoria_macro al elegir «Sin padrón». */
export const CATEGORIA_MACRO_SIN_PADRON = 'Sin padron' as const;

/** Variantes habituales en base_productos.categoriamacro (legacy / Quantio). */
export const VARIANTES_CATEGORIA_MACRO_SIN_PADRON = [
  'Sin padron',
  'Sin padrón',
  'SIN PADRON',
  'SIN PADRÓN',
] as const;

export type CategoriaMacro = (typeof CATEGORIAS_MACRO)[number];

export type CategoriaMacroInventarioDiario = CategoriaMacro | typeof CATEGORIA_MACRO_SIN_PADRON;

function normalizarTextoComparacionMacro(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function esCategoriaMacro(value: string): value is CategoriaMacro {
  return (CATEGORIAS_MACRO as readonly string[]).includes(value);
}

export function esCategoriaMacroSinPadron(valor: string | null | undefined): boolean {
  const t = normalizarTextoComparacionMacro(String(valor ?? ''));
  return t === 'sin padron';
}

/** Filtro PostgREST `.or(...)` para filas Sin padrón en base_productos. */
export function orFiltroCategoriamacroSinPadron(campoMacro = 'categoriamacro'): string {
  return VARIANTES_CATEGORIA_MACRO_SIN_PADRON.map((v) => `${campoMacro}.ilike.${v}`).join(',');
}

/** Solo FARMA / BIENESTAR / PSICOTROPICOS (excluye Sin padrón y cualquier otra macro). */
export function orFiltroMacrosPadronTrimestre(campoMacro = 'categoriamacro'): string {
  return CATEGORIAS_MACRO.map((m) => `${campoMacro}.ilike.${m}`).join(',');
}

type QueryConFiltroMacro = {
  ilike: (col: string, val: string) => QueryConFiltroMacro;
  or: (filters: string) => QueryConFiltroMacro;
};

/** Aplica ilike por macro de padrón o `.or` de variantes Sin padrón. */
export function filtrarQueryBaseProductosPorMacro<Q extends QueryConFiltroMacro>(
  query: Q,
  categoriaMacro: string,
  campoMacro = 'categoriamacro'
): Q {
  if (esCategoriaMacroSinPadron(categoriaMacro)) {
    return query.or(orFiltroCategoriamacroSinPadron(campoMacro)) as Q;
  }
  return query.ilike(campoMacro, categoriaMacro) as Q;
}

export function esCategoriaMacroInventarioDiario(
  value: string | null | undefined
): value is CategoriaMacroInventarioDiario {
  if (!value) return false;
  return esCategoriaMacro(value) || esCategoriaMacroSinPadron(value);
}

export function normalizarCategoriaMacro(
  valor: string | null | undefined
): CategoriaMacro | null {
  const t = String(valor ?? '')
    .trim()
    .toUpperCase();
  if (t === 'PSICOTROPICOS' || t === 'PSICOTROPICO') return 'PSICOTROPICOS';
  if (t === 'FARMA') return 'FARMA';
  if (t === 'BIENESTAR') return 'BIENESTAR';
  return null;
}
