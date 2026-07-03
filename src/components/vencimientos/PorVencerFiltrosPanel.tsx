'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { VistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';
import {
  FiltroVencimientoMesAnio,
  VENCIMIENTOS_FILTROS_GRID_CLASS,
} from '@/components/vencimientos/FiltroVencimientoMesAnio';

type MesVencOption = { readonly value: number; readonly label: string };

type RangeKey =
  | 'all'
  | '30_all'
  | '60_all'
  | '90_all'
  | '30_only'
  | '60_only'
  | '90_only';

interface PorVencerFiltrosPanelProps {
  abierto: boolean;
  onCerrar: () => void;
  vistaSelect: VistaPorVencerList;
  rangeKey: RangeKey;
  catMacroFiltro: string;
  categoriaFiltro: string;
  laboratorioFiltro: string;
  soloVentaPosterior: boolean;
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
  soloVentaPosterior,
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
                  let nextDays = 30;
                  let nextDaysMin = 0;
                  if (nextKey === 'all') {
                    nextDays = 365;
                    nextDaysMin = 0;
                  }
                  if (nextKey === '60_all') {
                    nextDays = 60;
                    nextDaysMin = 0;
                  }
                  if (nextKey === '90_all') {
                    nextDays = 90;
                    nextDaysMin = 0;
                  }
                  if (nextKey === '60_only') {
                    nextDays = 60;
                    nextDaysMin = 31;
                  }
                  if (nextKey === '30_only') {
                    nextDays = 30;
                    nextDaysMin = 1;
                  }
                  if (nextKey === '90_only') {
                    nextDays = 90;
                    nextDaysMin = 61;
                  }
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('days', String(nextDays));
                  params.set('daysMin', String(nextDaysMin));
                  router.push(`/vencimientos/por-vencer?${params.toString()}`);
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[120px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                <option value="30_all">Todos hasta 30 días</option>
                <option value="60_all">Todos hasta 60 días</option>
                <option value="90_all">Todos hasta 90 días</option>
                <option value="30_only">Solo a 30 días</option>
                <option value="60_only">Solo a 60 días</option>
                <option value="90_only">Solo a 90 días</option>
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
                Venta posterior
              </span>
              <label className="flex min-h-[4.125rem] cursor-pointer items-center gap-2 text-sm leading-snug text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-gray-300"
                  checked={soloVentaPosterior}
                  onChange={(e) => {
                    const p = new URLSearchParams(searchParams.toString());
                    if (e.target.checked) p.set('solo_venta_posterior', '1');
                    else p.delete('solo_venta_posterior');
                    router.replace(`/vencimientos/por-vencer?${p.toString()}`);
                  }}
                />
                Solo venta posterior a la carga
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
