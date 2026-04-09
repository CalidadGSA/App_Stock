import type { CSSProperties } from 'react';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const TIME_ZONE_AR = 'America/Argentina/Buenos_Aires';

/** Fecha local Argentina en YYYY-MM-DD (misma convención que inventario / vencimientos en servidor). */
export function fechaHoyArgentinaYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE_AR });
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

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-AR', {
    timeZone: TIME_ZONE_AR,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-AR', {
    timeZone: TIME_ZONE_AR,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function diasHastaVencimiento(fechaVenc: string): number {
  const hoy = new Date();
  const hoyUTC = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const [y, m, d] = String(fechaVenc).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  const vencUTC = Date.UTC(y, m - 1, d);
  return Math.ceil((vencUTC - hoyUTC) / 86400000);
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
