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

interface PorVencerConsolidadoFiltrosPanelProps {
  abierto: boolean;
  onCerrar: () => void;
  vistaSelect: VistaPorVencerList;
  rangeKey: RangeKey;
  onRangeKeyChange: (key: RangeKey) => void;
  sucursalFiltro: string;
  catMacroFiltro: string;
  categoriaFiltro: string;
  mesVencValido: number | null | undefined;
  anioVencValido: number | null | undefined;
  mesesVencOpts: readonly MesVencOption[];
  aniosVencOpts: number[];
  sucursales: Array<{ sucursal: number; nombrefantasia: string }>;
  catMacrosDisponibles: string[];
  categoriasDisponibles: string[];
  loading: boolean;
  onActualizar: () => void;
}

export function PorVencerConsolidadoFiltrosPanel({
  abierto,
  onCerrar,
  vistaSelect,
  rangeKey,
  onRangeKeyChange,
  sucursalFiltro,
  catMacroFiltro,
  categoriaFiltro,
  mesVencValido,
  anioVencValido,
  mesesVencOpts,
  aniosVencOpts,
  sucursales,
  catMacrosDisponibles,
  categoriasDisponibles,
  loading,
  onActualizar,
}: PorVencerConsolidadoFiltrosPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function buildParams(overrides: Record<string, string>) {
    const p = new URLSearchParams(searchParams.toString());
    p.set('consolidado', '1');
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '') p.delete(k);
      else p.set(k, v);
    }
    return p;
  }

  function push(overrides: Record<string, string> = {}) {
    router.push(`/vencimientos/por-vencer/consolidado?${buildParams(overrides).toString()}`);
  }

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
              Listado multi-sucursal: no consulta ventas posteriores a la carga (solo la pantalla por
              sucursal lo hace).
              {vistaSelect === 'por_vencer' &&
                ' Todas las sucursales · Excluye liquidados · Totales según filtros y búsqueda.'}
              {vistaSelect === 'vendidos' &&
                ' Solo liquidados en el rango de vencimientos · Todas las sucursales.'}
              {vistaSelect === 'vendido_parcial' &&
                ' Restante en control, al menos 1 unidad vendida registrada y sin liquidar (vendido=0) · Todas las sucursales.'}
              {vistaSelect === 'vencidos' &&
                ' Vencidos sin liquidar (fecha < hoy, restante > 0) en el periodo · Todas las sucursales.'}
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
                  const p = buildParams({});
                  if (next === 'por_vencer') p.delete('vista');
                  else p.set('vista', next);
                  router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
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
                  onRangeKeyChange(nextKey);
                  push({
                    days: String(nextDays),
                    daysMin: String(nextDaysMin),
                  });
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
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Sucursal</label>
              <select
                value={sucursalFiltro}
                onChange={(e) => {
                  push({
                    sucursal: e.target.value,
                    categoria: '',
                  });
                }}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[200px] dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="">Todas</option>
                {sucursales.map((s) => (
                  <option key={s.sucursal} value={String(s.sucursal)}>
                    {s.nombrefantasia?.trim() || `Sucursal ${s.sucursal}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Macro (padrón)
              </label>
              <select
                value={catMacroFiltro}
                onChange={(e) => {
                  push({
                    cat_macro: e.target.value,
                    categoria: '',
                  });
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
                  push({ categoria: e.target.value });
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
            <FiltroVencimientoMesAnio
              mesVencValido={mesVencValido}
              anioVencValido={anioVencValido}
              mesesVencOpts={mesesVencOpts}
              aniosVencOpts={aniosVencOpts}
              onMesChange={(v) => {
                const p = buildParams({});
                if (v) p.set('mes_venc', v);
                else p.delete('mes_venc');
                router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
              }}
              onAnioChange={(v) => {
                push({ anio_venc: v });
              }}
            />
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
