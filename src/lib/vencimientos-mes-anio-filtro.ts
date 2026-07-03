import { fechaHoyArgentinaYmd } from '@/lib/utils';

/** Calendario actual en Argentina (zona horaria de la app). */
export function calendarioActualArgentina(): { anio: number; mes: number; ym: string } {
  const ymd = fechaHoyArgentinaYmd();
  const [anio, mes] = ymd.split('-').map((n) => parseInt(n, 10));
  return { anio, mes, ym: `${anio}-${String(mes).padStart(2, '0')}` };
}

/** Compara YYYY-MM como cadena. */
export function clampYmNoFuturo(ym: string, maxYm?: string): string {
  const max = maxYm ?? calendarioActualArgentina().ym;
  const t = ym.trim();
  if (!t) return max;
  return t > max ? max : t;
}

/** Años hasta el actual (sin futuros), hacia atrás `cantidad` años inclusive. */
export function opcionesAnioHastaActual(cantidad = 5): number[] {
  const { anio } = calendarioActualArgentina();
  const out: number[] = [];
  for (let i = 0; i < cantidad; i++) out.push(anio - i);
  return out;
}

/** Meses seleccionables: en año pasado todos; en año actual o sin año solo hasta el mes en curso. */
export function mesesCalendarioSeleccionables(anio?: number | null) {
  const { anio: anioActual, mes: mesActual } = calendarioActualArgentina();
  if (anio != null && anio > 0 && anio < anioActual) {
    return MESES_CALENDARIO;
  }
  return MESES_CALENDARIO.filter((m) => m.value <= mesActual);
}

export function clampAnioMes(anio: number, mes: number): { anio: number; mes: number } {
  const { anio: anioActual, mes: mesActual } = calendarioActualArgentina();
  let a = anio;
  let m = mes;
  if (a > anioActual) a = anioActual;
  if (a === anioActual && m > mesActual) m = mesActual;
  if (m < 1) m = 1;
  if (m > 12) m = 12;
  return { anio: a, mes: m };
}

export function sanitizarAnioFiltro(anio: number | undefined): number | undefined {
  if (anio == null || !Number.isFinite(anio) || anio < 2000 || anio > 2100) return undefined;
  const { anio: max } = calendarioActualArgentina();
  if (anio > max) return undefined;
  return anio;
}

export function sanitizarMesFiltro(
  mes: number | undefined,
  anio?: number | null
): number | undefined {
  if (mes == null || !Number.isFinite(mes) || mes < 1 || mes > 12) return undefined;
  const permitidos = mesesCalendarioSeleccionables(anio);
  return permitidos.some((m) => m.value === mes) ? mes : undefined;
}

/** Filtra `YYYY-MM-DD` por mes (1–12) y/o año. */
export function pasaFiltroMesAnioYmd(
  fechaYmd: string,
  mes?: number | null,
  anio?: number | null
): boolean {
  if ((mes == null || mes === 0) && (anio == null || anio === 0)) return true;
  const ymd = String(fechaYmd ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m] = ymd.split('-').map((n) => parseInt(n, 10));
  if (anio != null && anio > 0 && y !== anio) return false;
  if (mes != null && mes >= 1 && mes <= 12 && m !== mes) return false;
  return true;
}

/** Años para filtro de vencimiento (incluye futuros). */
export function opcionesAnioVencimiento(pasado = 3, futuro = 5): number[] {
  const { anio } = calendarioActualArgentina();
  const out: number[] = [];
  for (let a = anio + futuro; a >= anio - pasado; a--) out.push(a);
  return out;
}

export function validarAnioVencFiltro(anio: number | undefined): number | undefined {
  if (anio == null || !Number.isFinite(anio) || anio < 2000 || anio > 2100) return undefined;
  return anio;
}

export function validarMesVencFiltro(
  mes: number | undefined,
  _anio?: number | null
): number | undefined {
  if (mes == null || !Number.isFinite(mes) || mes < 1 || mes > 12) return undefined;
  return mes;
}

export const MESES_CALENDARIO = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
] as const;
