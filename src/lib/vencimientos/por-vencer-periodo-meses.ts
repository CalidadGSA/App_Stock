/**
 * Los vencimientos a nivel sistema siempre caen en el último día del mes. Un filtro de
 * "N días" (30/60/90 fijos) genera un corte que no coincide con los meses calendario:
 * según qué día del mes sea "hoy", puede faltar el fin de un mes (ej. 1-dic + 60 días no
 * llega al 31-ene) o colarse de más el fin del mes siguiente (ej. 30-ene + 30 días sí
 * alcanza a fin de febrero). Estas funciones anclan el período a fin de mes calendario,
 * para que "este mes" / "el mes que viene" etc. sean siempre exactos, sin importar el día
 * del mes en que se consulte ni cuántos días tenga cada mes.
 */

/** Último día (YYYY-MM-DD) del mes ubicado `offsetMeses` meses después del mes de `hoyYmd`. */
export function finDeMesOffset(hoyYmd: string, offsetMeses: number): string {
  const [y, m] = String(hoyYmd)
    .slice(0, 7)
    .split('-')
    .map((n) => parseInt(n, 10));
  // Día 0 del mes siguiente al buscado = último día del mes buscado.
  const d = new Date(Date.UTC(y, m - 1 + offsetMeses + 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Días (con signo) desde `hoyYmd` hasta el fin del mes `offsetMeses` meses después
 * (0 = mes actual). Positivo si ese fin de mes todavía no pasó, negativo si ya pasó.
 */
export function diasHastaFinDeMes(hoyYmd: string, offsetMeses: number): number {
  const hoyMs = Date.parse(`${hoyYmd}T00:00:00Z`);
  const finMs = Date.parse(`${finDeMesOffset(hoyYmd, offsetMeses)}T00:00:00Z`);
  return Math.round((finMs - hoyMs) / 86400000);
}

export type RangePeriodoKey =
  | 'all'
  | '30_all'
  | '60_all'
  | '90_all'
  | '30_only'
  | '60_only'
  | '90_only';

type Nivel = 1 | 2 | 3;

const NIVEL_POR_CLAVE: Record<Exclude<RangePeriodoKey, 'all'>, Nivel> = {
  '30_all': 1,
  '60_all': 2,
  '90_all': 3,
  '30_only': 1,
  '60_only': 2,
  '90_only': 3,
};

/** Offset de mes (0 = mes actual) para un nivel 1/2/3, según se mire para adelante o para atrás. */
function offsetMesParaNivel(nivel: Nivel, esVencidos: boolean): number {
  return esVencidos ? -nivel : nivel - 1;
}

/** Traduce una clave de período (ancladas a fin de mes) a {days, daysMin} para el listado. */
export function calcularPeriodoParaRangeKey(
  hoyYmd: string,
  key: RangePeriodoKey,
  esVencidos: boolean
): { days: number; daysMin: number } {
  if (key === 'all') return { days: 365, daysMin: 0 };

  const nivel = NIVEL_POR_CLAVE[key];
  const offset = offsetMesParaNivel(nivel, esVencidos);
  const days = Math.max(1, Math.abs(diasHastaFinDeMes(hoyYmd, offset)));

  const esSolo = key.endsWith('_only');
  if (!esSolo || nivel === 1) return { days, daysMin: 0 };

  const offsetAnterior = offsetMesParaNivel((nivel - 1) as Nivel, esVencidos);
  const daysMin = Math.abs(diasHastaFinDeMes(hoyYmd, offsetAnterior)) + 1;
  return { days, daysMin };
}

const CLAVES: RangePeriodoKey[] = [
  'all',
  '30_all',
  '60_all',
  '90_all',
  '30_only',
  '60_only',
  '90_only',
];

/** Reconoce a qué clave de período corresponde un {days, daysMin} ya guardado en la URL. */
export function detectarRangeKey(
  hoyYmd: string,
  days: number,
  daysMin: number,
  esVencidos: boolean
): RangePeriodoKey {
  for (const key of CLAVES) {
    const calc = calcularPeriodoParaRangeKey(hoyYmd, key, esVencidos);
    if (calc.days === days && calc.daysMin === daysMin) return key;
  }
  return 'all';
}

/** Opciones para el <select> de período (el texto cambia según la vista sea "vencidos" o no). */
export function opcionesRangePeriodo(
  esVencidos: boolean
): Array<{ value: RangePeriodoKey; label: string }> {
  return [
    { value: 'all', label: 'Todos' },
    { value: '30_all', label: esVencidos ? 'El mes pasado' : 'Este mes' },
    { value: '60_all', label: esVencidos ? 'Últimos 2 meses' : 'Este mes y el que viene' },
    { value: '90_all', label: esVencidos ? 'Últimos 3 meses' : 'Próximos 3 meses' },
    { value: '60_only', label: esVencidos ? 'Solo hace 2 meses' : 'Solo el mes que viene' },
    { value: '90_only', label: esVencidos ? 'Solo hace 3 meses' : 'Solo dentro de 2 meses' },
  ];
}

/** Etiqueta corta para mostrar en el título/impresión ("Periodo: {etiqueta}"). */
export function etiquetaPeriodoParaRangeKey(key: RangePeriodoKey, esVencidos: boolean): string {
  if (key === 'all') return 'todos';
  const nivel = NIVEL_POR_CLAVE[key];
  const esSolo = key.endsWith('_only');
  if (esVencidos) {
    if (esSolo && nivel === 2) return 'solo hace 2 meses';
    if (esSolo && nivel === 3) return 'solo hace 3 meses';
    if (nivel === 1) return 'el mes pasado';
    if (nivel === 2) return 'los últimos 2 meses';
    return 'los últimos 3 meses';
  }
  if (esSolo && nivel === 2) return 'solo el mes que viene';
  if (esSolo && nivel === 3) return 'solo dentro de 2 meses';
  if (nivel === 1) return 'este mes';
  if (nivel === 2) return 'este mes y el que viene';
  return 'próximos 3 meses';
}
