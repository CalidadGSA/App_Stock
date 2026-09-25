/**
 * Validación de los valores que se cargan a mano en las columnas de clasificación del padrón.
 *
 * `categoria` y `sub_categoria` son texto libre, así que un error de tipeo crea una categoría
 * nueva sin que nadie se entere: «MEDICAMENTO» conviviendo con «MEDICAMENTOS». Estas funciones
 * comparan contra lo que ya existe y proponen los parecidos antes de dejar crear uno nuevo.
 */

/** Columnas con validación contra los valores ya cargados. */
export const COLUMNAS_PADRON_CON_CATALOGO = ['categoria', 'sub_categoria'] as const;

export type ColumnaPadronConCatalogo = (typeof COLUMNAS_PADRON_CON_CATALOGO)[number];

export function esColumnaConCatalogo(columna: string): columna is ColumnaPadronConCatalogo {
  return (COLUMNAS_PADRON_CON_CATALOGO as readonly string[]).includes(
    String(columna ?? '').trim().toLowerCase()
  );
}

export interface ValorCatalogo {
  valor: string;
  /** Cuántos productos lo usan; sirve para ordenar las sugerencias. */
  usos: number;
}

/** Mayúsculas, sin acentos y con los espacios colapsados: así se comparan dos valores. */
export function normalizarValor(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Distancia de Levenshtein, acotada: si supera `max` devuelve `max + 1` y corta. */
export function distancia(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    let mejorDeLaFila = i;

    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      actual.push(v);
      if (v < mejorDeLaFila) mejorDeLaFila = v;
    }

    if (mejorDeLaFila > max) return max + 1;
    previa = actual;
  }

  return previa[b.length];
}

export type CoincidenciaValor =
  /** El valor ya existe tal cual. */
  | { tipo: 'exacto'; valor: string }
  /** Existe pero escrito distinto (mayúsculas, acentos, espacios): conviene usar el de la base. */
  | { tipo: 'equivalente'; valor: string }
  /** No existe. `similares` son los candidatos ordenados de más a menos parecido. */
  | { tipo: 'nuevo'; similares: ValorCatalogo[] };

/** Umbral de distancia según el largo: en textos cortos un error de más ya es otra palabra. */
function maxDistancia(largo: number): number {
  if (largo <= 4) return 1;
  if (largo <= 8) return 2;
  return 3;
}

/**
 * Compara el valor tipeado contra el catálogo existente.
 * Considera parecidos los que difieren en pocos caracteres, los que son prefijo del otro
 * (MEDICAMENTO / MEDICAMENTOS) y los que contienen el texto.
 */
export function evaluarValor(
  valor: string,
  catalogo: ValorCatalogo[],
  maxSugerencias = 5
): CoincidenciaValor | null {
  const limpio = String(valor ?? '').trim();
  if (!limpio) return null;

  const exacto = catalogo.find((c) => c.valor === limpio);
  if (exacto) return { tipo: 'exacto', valor: exacto.valor };

  const norm = normalizarValor(limpio);
  const equivalente = catalogo.find((c) => normalizarValor(c.valor) === norm);
  if (equivalente) return { tipo: 'equivalente', valor: equivalente.valor };

  const tope = maxDistancia(norm.length);

  const puntuados = catalogo
    .map((c) => {
      const cn = normalizarValor(c.valor);
      const d = distancia(norm, cn, tope);
      const prefijo = cn.startsWith(norm) || norm.startsWith(cn);
      const contiene = cn.includes(norm) || norm.includes(cn);

      if (d <= tope) return { c, orden: d };
      if (prefijo) return { c, orden: tope + 1 };
      if (contiene && norm.length >= 4) return { c, orden: tope + 2 };
      return null;
    })
    .filter((x): x is { c: ValorCatalogo; orden: number } => x !== null)
    .sort((a, b) => a.orden - b.orden || b.c.usos - a.c.usos)
    .slice(0, maxSugerencias)
    .map((x) => x.c);

  return { tipo: 'nuevo', similares: puntuados };
}
