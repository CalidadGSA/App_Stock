import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const TIME_ZONE_AR = 'America/Argentina/Buenos_Aires';

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
  if (dias < 0) return 'text-red-700 bg-red-50 border-red-200';
  if (dias <= 30) return 'text-orange-700 bg-orange-50 border-orange-200';
  if (dias <= 60) return 'text-yellow-700 bg-yellow-50 border-yellow-200';
  return 'text-green-700 bg-green-50 border-green-200';
}
