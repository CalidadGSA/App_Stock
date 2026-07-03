import { diasHastaVencimiento } from '@/lib/utils';
import type { VistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';
import { esLineaSinLiquidar } from '@/lib/vencimientos/por-vencer-saldo';

export { esLineaSinLiquidar } from '@/lib/vencimientos/por-vencer-saldo';

/** Replica el filtro de rango (days / daysMin) del listado por-vencer en cliente. */
export function filtrarPorVencerPorPeriodo<
  T extends {
    fecha_vencimiento: string;
    cantidad?: number;
    vendido?: number;
  },
>(items: T[], vista: VistaPorVencerList, days: number, daysMin: number): T[] {
  const dMax = Math.min(Math.max(days, 1), 365);
  const dMin = Math.max(0, Math.min(daysMin, dMax));

  return items.filter((i) => {
    const dias = diasHastaVencimiento(i.fecha_vencimiento);
    if (vista === 'vencidos') {
      if (!esLineaSinLiquidar(i.cantidad, i.vendido)) return false;
      return dias < 0 && dias >= -dMax;
    }
    if (vista === 'vendidos') {
      if (dias < dMin || dias > dMax) return false;
      const cant = Number(i.cantidad ?? 0);
      const ven = Number(i.vendido ?? 0);
      return cant <= 0 || ven === 1;
    }
    return dias >= dMin && dias <= dMax;
  });
}

export function periodoCubiertoPorCache(
  cache: { days: number; daysMin: number },
  solicitado: { days: number; daysMin: number }
): boolean {
  const dCache = Math.min(Math.max(cache.days, 1), 365);
  const dSol = Math.min(Math.max(solicitado.days, 1), 365);
  const minCache = Math.max(0, Math.min(cache.daysMin, dCache));
  const minSol = Math.max(0, Math.min(solicitado.daysMin, dSol));
  return dCache >= dSol && minCache <= minSol;
}
