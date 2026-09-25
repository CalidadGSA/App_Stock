import type { CSSProperties } from 'react';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const TIME_ZONE_AR = 'America/Argentina/Buenos_Aires';

/** Fecha local Argentina en YYYY-MM-DD (misma convención que inventario / vencimientos en servidor). */
export function fechaHoyArgentinaYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE_AR });
}

/** YYYY-MM-DD del instante ISO en calendario Argentina. */
export function ymdDesdeIsoArgentina(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE_AR });
}

/**
 * Rango [desde, hasta] inclusive en días calendario Argentina → límites ISO UTC para Postgres.
 * (UTC-3: 00:00 AR = 03:00 UTC del mismo YMD; fin del día AR = 02:59:59.999 UTC del día siguiente).
 */
export function rangoFechasArgentinaIso(
  desdeYmd: string,
  hastaYmd: string
): { desdeIso: string; hastaIso: string } {
  return {
    desdeIso: `${desdeYmd}T03:00:00.000Z`,
    hastaIso: `${ymdAddDays(hastaYmd, 1)}T02:59:59.999Z`,
  };
}

/** 00:00 del día calendario Argentina (hoy) en ISO UTC para Postgres. */
export function medianocheHoyArgentinaIso(): string {
  return rangoFechasArgentinaIso(fechaHoyArgentinaYmd(), fechaHoyArgentinaYmd()).desdeIso;
}

/** Suma días a una fecha YYYY-MM-DD (calendario, sin hora). */
export function ymdAddDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = String(ymd)
    .split('-')
    .map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd);
  const ms = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Intervalo medio abierto [desde_iso, hasta_exclusivo_iso) cubriendo el mes calendario Argentina (primer día 00:00 AR → primer día del mes siguiente 00:00 AR).
 */
export function rangoMedioAbiertoMesArgentinaYm(
  year: number,
  month1_12: number
): { desdeIso: string; hastaExclusivoIso: string } {
  if (!Number.isFinite(year) || month1_12 < 1 || month1_12 > 12) {
    return { desdeIso: '', hastaExclusivoIso: '' };
  }
  const primerDia = `${year}-${String(month1_12).padStart(2, '0')}-01`;
  const lastDom = new Date(year, month1_12, 0).getDate();
  const ultimoDia = `${year}-${String(month1_12).padStart(2, '0')}-${String(lastDom).padStart(2, '0')}`;
  const siguiente = ymdAddDays(ultimoDia, 1);
  const { desdeIso } = rangoFechasArgentinaIso(primerDia, primerDia);
  const { desdeIso: hastaExclusivoIso } = rangoFechasArgentinaIso(siguiente, siguiente);
  return { desdeIso, hastaExclusivoIso };
}

export function anteriorMesYm(year: number, month1_12: number): { year: number; month: number } {
  if (month1_12 > 1) return { year, month: month1_12 - 1 };
  return { year: year - 1, month: 12 };
}

export function parseYm(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Porcentaje con N decimales (valor 0–100). */
export function porcentajeDesdeRatio(
  numerador: number,
  denominador: number,
  decimales = 2
): number {
  if (denominador <= 0) return 0;
  const f = 10 ** decimales;
  return Math.round((numerador / denominador) * 100 * f) / f;
}

export function formatPorcentaje(valor: number, decimales = 2): string {
  return valor.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** YYYY-MM-DD sin hora (columnas `date` en Postgres). */
export function parseYmdCalendario(s: string | null | undefined): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

function dateCalendarioArgentina(parts: { y: number; mo: number; d: number }): Date {
  return new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 12, 0, 0));
}

/** Armado fijo DD/MM/AAAA (no depende del locale del runtime). */
function formatPartsDmy(y: number, mo: number, d: number): string {
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

function partsFechaArgentina(date: Date): { y: number; mo: number; d: number; h: number; mi: number } | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE_AR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year'));
  const mo = Number(get('month'));
  const d = Number(get('day'));
  const h = Number(get('hour'));
  const mi = Number(get('minute'));
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;
  return { y, mo, d, h, mi };
}

/** Fecha visible en UI: siempre DD/MM/AAAA. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const ymd = parseYmdCalendario(String(dateStr).slice(0, 10));
  if (ymd) return formatPartsDmy(ymd.y, ymd.mo, ymd.d);
  const parts = partsFechaArgentina(new Date(dateStr));
  if (!parts) return '—';
  return formatPartsDmy(parts.y, parts.mo, parts.d);
}

/** Fecha DD/MM/AAAA para nombres de archivos exportables (acepta YYYY-MM-DD o ISO). */
export function formatDateForFilename(dateStr: string | null | undefined): string {
  const s = formatDate(dateStr);
  return s === '—' ? 'sin-fecha' : s;
}

/** Mes YYYY-MM → MM/AAAA para nombres de archivo. */
export function formatYmForFilename(ym: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? '').trim());
  if (!m) return String(ym ?? '').trim() || 'sin-mes';
  return `${m[2]}/${m[1]}`;
}

/** Rango legible para períodos trimestrales: "Del 1 de abril al 30 de junio de 2026". */
export function formatRangoFechasLargo(
  desde: string | null | undefined,
  hasta: string | null | undefined,
): string {
  const a = parseYmdCalendario(desde);
  const b = parseYmdCalendario(hasta);
  if (!a || !b) {
    if (!desde && !hasta) return '—';
    return `${formatDate(desde)} – ${formatDate(hasta)}`;
  }
  const fmtDiaMes = new Intl.DateTimeFormat('es-AR', {
    timeZone: TIME_ZONE_AR,
    day: 'numeric',
    month: 'long',
  });
  const ini = fmtDiaMes.format(dateCalendarioArgentina(a));
  const fin = fmtDiaMes.format(dateCalendarioArgentina(b));
  if (a.y === b.y) return `Del ${ini} al ${fin} de ${a.y}`;
  return `Del ${ini} de ${a.y} al ${fin} de ${b.y}`;
}

/** Fecha+hora visible en UI: siempre DD/MM/AAAA HH:mm (24h, zona Argentina). */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parts = partsFechaArgentina(new Date(dateStr));
  if (!parts) return '—';
  return `${formatPartsDmy(parts.y, parts.mo, parts.d)} ${String(parts.h).padStart(2, '0')}:${String(parts.mi).padStart(2, '0')}`;
}

/** Ahora mismo en Argentina, mismo formato que formatDateTime. */
export function formatNowDateTime(): string {
  return formatDateTime(new Date().toISOString());
}

/** Formatea un monto en pesos argentinos, ej. "$ 12.345". */
export function formatMoneda(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function diasHastaVencimiento(fechaVenc: string): number {
  // "Hoy" en calendario Argentina (igual que el servidor), no en la TZ local del runtime.
  const [hy, hm, hd] = fechaHoyArgentinaYmd().split('-').map((n) => parseInt(n, 10));
  const hoyUTC = Date.UTC(hy, hm - 1, hd);
  const [y, m, d] = String(fechaVenc).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  const vencUTC = Date.UTC(y, m - 1, d);
  return Math.ceil((vencUTC - hoyUTC) / 86400000);
}

/** Texto operativo: días hasta el vencimiento (positivo = por vencer). */
export function etiquetaDiasHastaVencimiento(dias: number): string {
  if (dias < 0) {
    const n = Math.abs(dias);
    return `Venció hace ${n} día${n !== 1 ? 's' : ''}`;
  }
  if (dias === 0) return 'Vence hoy';
  return `Vence en ${dias} día${dias !== 1 ? 's' : ''}`;
}

export function colorVencimiento(dias: number): string {
  if (dias < 0) return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/30 dark:border-red-900/60';
  if (dias <= 30) return 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-950/30 dark:border-orange-900/60';
  if (dias <= 60) return 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-300 dark:bg-yellow-950/30 dark:border-yellow-900/60';
  return 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950/30 dark:border-green-900/60';
}

/**
 * Fondo de fila por progreso de venta: vendido hist. / (restante + vendido), en deciles del 10 % (rojo → verde).
 */
export function estiloFilaProgresoVenta(cantidad: number, vendidaHist: number): CSSProperties {
  const r = Math.max(0, Number(cantidad) || 0);
  const v = Math.max(0, Number(vendidaHist) || 0);
  const total = r + v;
  if (total <= 0) {
    return { backgroundColor: 'hsla(215, 14%, 50%, 0.1)' };
  }
  const p = Math.min(1, Math.max(0, v / total));
  const decil = Math.min(9, Math.floor(p * 10));
  const t = decil / 9;
  const hue = Math.round(120 * t);
  return {
    backgroundColor: `hsla(${hue}, 72%, 44%, 0.22)`,
  };
}
