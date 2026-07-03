import { ymdAddDays } from '@/lib/utils';
import {
  esProductoOtcPadron,
  macroBultoParaProducto,
  macroDesdePadronCompleto,
  type MedicamentoDrogueriaMeta,
  type PadronProductoResumen,
} from '@/lib/vencimientos-drogueria-lab';

export type MacroParaDevolver = 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS';

/** BIENESTAR: entra en lista si faltan menos de N días para vencer. */
export const DIAS_VENTANA_BIENESTAR = 10;

/** En el mes de devolución FARMA/PSICO: solo si faltan menos de N días para vencer. */
export const DIAS_VENTANA_FARMA_PSICO_MES_DEVOLUCION = 40;

/** Subrubros que aplican reglas de devolución FARMA aunque el padrón diga otra macro. */
export const IDSUBRUBROS_REGLA_DEVOLUCION_FARMA = new Set([28]);

export function macroEfectivaParaDevolver(
  catPadron: MacroParaDevolver | null,
  idsubrubro: number | null | undefined
): MacroParaDevolver | null {
  const id = idsubrubro != null && Number.isFinite(Number(idsubrubro)) ? Number(idsubrubro) : null;
  if (id != null && IDSUBRUBROS_REGLA_DEVOLUCION_FARMA.has(id)) return 'FARMA';
  return catPadron;
}

export type MesAnio = { year: number; month: number };

export function mesAnioDesdeYmd(fechaYmd: string): MesAnio | null {
  const [y, m] = String(fechaYmd ?? '').slice(0, 10).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

function mesAnioAIndice({ year, month }: MesAnio): number {
  return year * 12 + (month - 1);
}

/** Días calendario entre dos YYYY-MM-DD (hasta − desde). */
export function diasEntreYmd(desdeYmd: string, hastaYmd: string): number {
  const parse = (s: string) => {
    const [y, m, d] = String(s ?? '').slice(0, 10).split('-').map((n) => parseInt(n, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
    return Date.UTC(y, m - 1, d);
  };
  const desde = parse(desdeYmd);
  const hasta = parse(hastaYmd);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return NaN;
  return Math.ceil((hasta - desde) / 86400000);
}

export function mesSiguiente(year: number, month: number): MesAnio {
  if (month >= 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function mesAnterior(year: number, month: number): MesAnio {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function mesAnteriorN(year: number, month: number, n: number): MesAnio {
  let y = year;
  let m = month;
  for (let i = 0; i < n; i++) {
    const prev = mesAnterior(y, m);
    y = prev.year;
    m = prev.month;
  }
  return { year: y, month: m };
}

/** Primer día del mes (YYYY-MM-DD). */
export function primerDiaMes(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Último día del mes (YYYY-MM-DD). */
export function ultimoDiaMes(year: number, month: number): string {
  const siguiente = mesSiguiente(year, month);
  const ultimo = ymdAddDays(primerDiaMes(siguiente.year, siguiente.month), -1);
  return ultimo;
}

/**
 * BIENESTAR: aparece si faltan menos de 10 días para vencer (o ya venció y sigue pendiente).
 */
export function entraEnListaParaDevolverBienestar(
  fechaVencYmd: string,
  hoyYmd: string
): boolean {
  const fv = String(fechaVencYmd ?? '').trim().slice(0, 10);
  const hoy = String(hoyYmd ?? '').trim().slice(0, 10);
  const diasHastaVencer = diasEntreYmd(hoy, fv);
  if (!Number.isFinite(diasHastaVencer)) return false;
  if (diasHastaVencer < 0) return true;
  return diasHastaVencer < DIAS_VENTANA_BIENESTAR;
}

/**
 * FARMA / PSICOTROPICOS: devolución a fin del mes anterior al de vencimiento
 * (ej. vence 30/06 → devolver fin de mayo).
 *
 * - Antes del mes de devolución: no aparece.
 * - Durante el mes de devolución: solo si faltan &lt; 40 días para vencer.
 * - Después del mes de devolución: pendiente atrasado (sigue en lista).
 */
export function entraEnListaParaDevolverFarma(
  fechaVencYmd: string,
  hoyYmd: string
): boolean {
  const fv = String(fechaVencYmd ?? '').trim().slice(0, 10);
  const hoy = String(hoyYmd ?? '').trim().slice(0, 10);
  const v = mesAnioDesdeYmd(fv);
  const h = mesAnioDesdeYmd(hoy);
  if (!v || !h) return false;

  const mesDevolucion = mesAnterior(v.year, v.month);
  const devIdx = mesAnioAIndice(mesDevolucion);
  const hoyIdx = mesAnioAIndice(h);

  if (hoyIdx < devIdx) return false;
  if (hoyIdx > devIdx) return true;

  const diasHastaVencer = diasEntreYmd(hoy, fv);
  return (
    Number.isFinite(diasHastaVencer) &&
    diasHastaVencer < DIAS_VENTANA_FARMA_PSICO_MES_DEVOLUCION
  );
}

export function entraEnListaParaDevolverConMacro(
  catEfectiva: MacroParaDevolver | null,
  fechaVencYmd: string,
  hoyYmd: string
): boolean {
  const fv = String(fechaVencYmd ?? '').trim().slice(0, 10);
  if (!fv || !catEfectiva) return false;
  if (catEfectiva === 'BIENESTAR') return entraEnListaParaDevolverBienestar(fv, hoyYmd);
  if (catEfectiva === 'FARMA' || catEfectiva === 'PSICOTROPICOS') {
    return entraEnListaParaDevolverFarma(fv, hoyYmd);
  }
  return false;
}

/**
 * Macro para reglas de devolución: padrón → control → psicofármaco → FARMA por defecto,
 * luego override por idsubrubro (ej. 28).
 */
export function macroParaReglaDevolucion(
  padron: PadronProductoResumen | undefined,
  medicamentoMeta: MedicamentoDrogueriaMeta | undefined,
  nombrePsicoPorId: Map<string, string>,
  idsubrubro?: number | null,
  controlCategoriaMacro?: string | null
): MacroParaDevolver | null {
  if (esProductoOtcPadron(padron)) {
    return macroEfectivaParaDevolver('FARMA', idsubrubro);
  }
  let cat = macroDesdePadronCompleto(padron, controlCategoriaMacro);
  if (!cat) cat = macroBultoParaProducto(padron, medicamentoMeta, nombrePsicoPorId);
  if (!cat) cat = 'FARMA';
  return macroEfectivaParaDevolver(cat, idsubrubro);
}

export function entraEnListaParaDevolver(
  cat: MacroParaDevolver | null,
  fechaVencYmd: string,
  hoyYmd: string,
  idsubrubro?: number | null
): boolean {
  const catEfectiva = macroEfectivaParaDevolver(cat, idsubrubro);
  return entraEnListaParaDevolverConMacro(catEfectiva, fechaVencYmd, hoyYmd);
}

/** Rango de fechas de vencimiento a traer de BD (incluye atrasados y el mes siguiente). */
export function rangoFechasVencimientoQuery(hoyYmd: string): { desde: string; hasta: string } {
  const h = mesAnioDesdeYmd(hoyYmd);
  if (!h) {
    return { desde: hoyYmd, hasta: ymdAddDays(hoyYmd, 62) };
  }
  const lookback = mesAnteriorN(h.year, h.month, 18);
  const limiteSuperior = mesSiguiente(h.year, h.month);
  return {
    desde: primerDiaMes(lookback.year, lookback.month),
    hasta: ultimoDiaMes(limiteSuperior.year, limiteSuperior.month),
  };
}
