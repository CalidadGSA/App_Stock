/**
 * Feriados nacionales de Argentina y conteo de días hábiles.
 *
 * Reemplaza a la librería `holidays` de Python que usaban los pipelines de n8n; se validó
 * que devuelve exactamente las mismas fechas para 2025, 2026 y 2027.
 */

import { ymdAddDays } from '@/lib/utils';

/** Inamovibles, siempre en la misma fecha. */
const FIJOS: ReadonlyArray<[number, number, string]> = [
  [1, 1, 'Año Nuevo'],
  [3, 24, 'Día Nacional de la Memoria'],
  [4, 2, 'Día del Veterano y de los Caídos en Malvinas'],
  [5, 1, 'Día del Trabajo'],
  [5, 25, 'Día de la Revolución de Mayo'],
  [6, 20, 'Paso a la Inmortalidad del General Belgrano'],
  [7, 9, 'Día de la Independencia'],
  [12, 8, 'Inmaculada Concepción de María'],
  [12, 25, 'Navidad'],
];

/**
 * Trasladables: si caen martes o miércoles se mueven al lunes anterior; si caen jueves o
 * viernes, al lunes siguiente. Sábado, domingo y lunes quedan donde están.
 */
const TRASLADABLES: ReadonlyArray<[number, number, string]> = [
  [6, 17, 'Paso a la Inmortalidad del General Güemes'],
  [8, 17, 'Paso a la Inmortalidad del General San Martín'],
  [10, 12, 'Día del Respeto a la Diversidad Cultural'],
  [11, 20, 'Día de la Soberanía Nacional'],
];

/**
 * Feriados con fines turísticos: los fija el Poder Ejecutivo por decreto, año por año, así
 * que no hay regla que los calcule. **Hay que agregar los del año nuevo cuando se publiquen.**
 */
const PUENTES_TURISTICOS: Readonly<Record<number, readonly string[]>> = {
  2025: ['2025-05-02', '2025-08-15', '2025-11-21'],
  2026: ['2026-03-23', '2026-07-10', '2026-12-07'],
  2027: [],
};

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function ymd(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** 0 = domingo … 6 = sábado, sin pasar por la zona horaria local. */
export function diaDeSemana(fechaYmd: string): number {
  const [y, m, d] = fechaYmd.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function trasladar(fechaYmd: string): string {
  const dow = diaDeSemana(fechaYmd);
  if (dow === 2 || dow === 3) return ymdAddDays(fechaYmd, -(dow - 1));
  if (dow === 4 || dow === 5) return ymdAddDays(fechaYmd, 8 - dow);
  return fechaYmd;
}

const cache = new Map<number, Map<string, string>>();

/** Feriados nacionales del año, como fecha YYYY-MM-DD → nombre. */
export function feriadosArgentina(anio: number): Map<string, string> {
  const cacheado = cache.get(anio);
  if (cacheado) return cacheado;

  const feriados = new Map<string, string>();
  const agregar = (fecha: string, nombre: string) => {
    const previo = feriados.get(fecha);
    feriados.set(fecha, previo ? `${previo}; ${nombre}` : nombre);
  };

  for (const [mes, dia, nombre] of FIJOS) agregar(ymd(anio, mes, dia), nombre);
  for (const [mes, dia, nombre] of TRASLADABLES) agregar(trasladar(ymd(anio, mes, dia)), nombre);

  const pascua = domingoDePascua(anio);
  agregar(ymdAddDays(pascua, -48), 'Lunes de Carnaval');
  agregar(ymdAddDays(pascua, -47), 'Martes de Carnaval');
  agregar(ymdAddDays(pascua, -3), 'Jueves Santo');
  agregar(ymdAddDays(pascua, -2), 'Viernes Santo');

  for (const fecha of PUENTES_TURISTICOS[anio] ?? []) {
    agregar(fecha, 'Feriado con fines turísticos');
  }

  cache.set(anio, feriados);
  return feriados;
}

export function esFeriadoArgentina(fechaYmd: string): boolean {
  const anio = parseInt(fechaYmd.slice(0, 4), 10);
  if (!Number.isFinite(anio)) return false;
  return feriadosArgentina(anio).has(fechaYmd);
}

/**
 * Días hábiles entre dos fechas inclusive: descarta sábados, domingos y feriados nacionales.
 * Es el mismo cálculo que hacía count_business_days_argentina en los scripts de n8n.
 */
export function contarDiasHabiles(desdeYmd: string, hastaYmd: string): number {
  if (!desdeYmd || !hastaYmd || desdeYmd > hastaYmd) return 0;

  let total = 0;
  for (let fecha = desdeYmd; fecha <= hastaYmd; fecha = ymdAddDays(fecha, 1)) {
    const dow = diaDeSemana(fecha);
    if (dow === 0 || dow === 6) continue;
    if (esFeriadoArgentina(fecha)) continue;
    total += 1;
  }
  return total;
}
