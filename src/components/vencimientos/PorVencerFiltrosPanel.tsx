'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fechaHoyArgentinaYmd } from '@/lib/utils';
import type { VistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';
import {
  FiltroVencimientoMesAnio,
  VENCIMIENTOS_FILTROS_GRID_CLASS,
} from '@/components/vencimientos/FiltroVencimientoMesAnio';
import {
  calcularPeriodoParaRangeKey,
  opcionesRangePeriodo,
  type RangePeriodoKey,
} from '@/lib/vencimientos/por-vencer-periodo-meses';

type MesVencOption = { readonly value: number; readonly label: string };

type RangeKey = RangePeriodoKey;

interface PorVencerFiltrosPanelProps {
  abierto: boolean;
  onCerrar: () => void;
  vistaSelect: VistaPorVencerList;
  rangeKey: RangeKey;
  catMacroFiltro: string;
  categoriaFiltro: string;
  laboratorioFiltro: string;
  soloConVentas: boolean;
  mesVencValido: number | null | undefined;
  anioVencValido: number | null | undefined;
  mesesVencOpts: readonly MesVencOption[];
  aniosVencOpts: number[];
  catMacrosDisponibles: string[];
  categoriasDisponibles: string[];
  laboratoriosDisponibles: string[];
  loading: boolean;
  onActualizar: () => void;
}

export function PorVencerFiltrosPanel({
  abierto,
  onCerrar,
  vistaSelect,
  rangeKey,
  catMacroFiltro,
  categoriaFiltro,
  laboratorioFiltro,
  soloConVentas,
  mesVencValido,
  anioVencValido,
  mesesVencOpts,
  aniosVencOpts,
  catMacrosDisponibles,
  categoriasDisponibles,
  laboratoriosDisponibles,
  loading,
  onActualizar,
}: PorVencerFiltrosPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (!abierto) return null;

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-20 bg-black/40 print:hidden"
        aria-label="Cerrar filtros"
        onClick={onCerrar}
      />
      <div className="absolute inset-x-0 top-0 z-30 max-h-full overflow-y-auto rounded-b-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-slate-900 print:hidden">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Filtros</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {vistaSelect === 'por_vencer' &&
                'Por vencer: fechas desde hoy según el periodo. Excluye liquidados; usá la vista «Solo vendidos (liquidados)» para verlos.'}
              {vistaSelect === 'vendidos' &&
                'Solo líneas liquidadas dentro del rango de fechas de vencimiento (según periodo).'}
              {vistaSelect === 'vencidos' &&
                'Productos con fecha de vencimiento anterior a hoy y saldo sin liquidar (restante > 0), en los últimos N días según el periodo.'}
              {vistaSelect === 'vendido_parcial' &&
                'Solo líneas no liquidadas (restante y stock en control), con al menos 1 unidad vendida registrada y vendido=0 en el control.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Cerrar filtros"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className={VENCIMIENTOS_FILTROS_GRID_CLASS}>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Vista</label>
              <select
                value={vistaSelect}
                onChange={(e) => {
                  const next = e.target.value;
                  const params = new URLSearchParams(searchParams.toString());
                  if (next === 'por_vencer') params.delete('vista');
                  else params.set('vista', next);
                  router.push(`/vencimientos/por-vencer?${params.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[160px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="por_vencer">Por vencer</option>
                <option value="vendido_parcial">Solo vendido parcial</option>
                <option value="vendidos">Solo vendidos (liquidados)</option>
                <option value="vencidos">Solo vencidos</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Periodo</label>
              <select
                value={rangeKey}
                onChange={(e) => {
                  const nextKey = e.target.value as RangeKey;
                  const { days: nextDays, daysMin: nextDaysMin } = calcularPeriodoParaRangeKey(
                    fechaHoyArgentinaYmd(),
                    nextKey,
                    vistaSelect === 'vencidos'
                  );
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('days', String(nextDays));
                  params.set('daysMin', String(nextDaysMin));
                  router.push(`/vencimientos/por-vencer?${params.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[120px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                {opcionesRangePeriodo(vistaSelect === 'vencidos').map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Cat. Macro
              </label>
              <select
                value={catMacroFiltro}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams.toString());
                  if (e.target.value) p.set('cat_macro', e.target.value);
                  else p.delete('cat_macro');
                  p.delete('categoria');
                  router.replace(`/vencimientos/por-vencer?${p.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[180px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="">Todas</option>
                {catMacrosDisponibles.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Categoría
              </label>
              <select
                value={categoriaFiltro}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams.toString());
                  if (e.target.value) p.set('categoria', e.target.value);
                  else p.delete('categoria');
                  router.replace(`/vencimientos/por-vencer?${p.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[220px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="">Todas</option>
                {categoriasDisponibles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Laboratorio
              </label>
              <select
                value={laboratorioFiltro}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams.toString());
                  if (e.target.value) p.set('laboratorio', e.target.value);
                  else p.delete('laboratorio');
                  router.replace(`/vencimientos/por-vencer?${p.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[220px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="">Todos</option>
                {laboratoriosDisponibles.map((lab) => (
                  <option key={lab} value={lab}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
            <FiltroVencimientoMesAnio
              mesVencValido={mesVencValido}
              anioVencValido={anioVencValido}
              mesesVencOpts={mesesVencOpts}
              aniosVencOpts={aniosVencOpts}
              onMesChange={(v) => {
                const p = new URLSearchParams(searchParams.toString());
                if (v) p.set('mes_venc', v);
                else p.delete('mes_venc');
                router.replace(`/vencimientos/por-vencer?${p.toString()}`);
              }}
              onAnioChange={(v) => {
                const p = new URLSearchParams(searchParams.toString());
                if (v) p.set('anio_venc', v);
                else p.delete('anio_venc');
                router.replace(`/vencimientos/por-vencer?${p.toString()}`);
              }}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Con ventas
              </span>
              <label className="flex min-h-[4.125rem] cursor-pointer items-center gap-2 text-sm leading-snug text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-gray-300"
                  checked={soloConVentas}
                  onChange={(e) => {
                    const p = new URLSearchParams(searchParams.toString());
                    if (e.target.checked) p.set('solo_con_ventas', '1');
                    else p.delete('solo_con_ventas');
                    router.replace(`/vencimientos/por-vencer?${p.toString()}`);
                  }}
                />
                Solo con ventas registradas
              </label>
            </div>
            <div className="flex items-end">
              <Button size="sm" variant="secondary" disabled={loading} onClick={onActualizar}>
                Actualizar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
