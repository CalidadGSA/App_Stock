'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import {
  formatDate,
  formatDateTime,
  diasHastaVencimiento,
  colorVencimiento,
  estiloFilaProgresoVenta,
} from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import { isAdminLikeRole } from '@/lib/auth/roles';

interface ConsolidadoItem {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro?: string;
  cantidad: number;
  /** Unidades vendidas registradas (suma histórica vía por-vencer) */
  cantidad_vendida_acumulada?: number;
  vendido?: number;
  sucursal_id: number;
  sucursal_nombre?: string | null;
  cat_macro: string | null;
  categoria: string | null;
  descuento_aplicado?: number | null;
}

export default function PorVencerConsolidadoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ConsolidadoItem[]>([]);
  const [sucursales, setSucursales] = useState<Array<{ sucursal: number; nombrefantasia: string }>>([]);
  const [catMacros, setCatMacros] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [rangeKey, setRangeKey] = useState<
    'all' | '30_all' | '60_all' | '90_all' | '30_only' | '60_only' | '90_only'
  >('all');

  const sucursalFiltro = searchParams.get('sucursal') ?? '';
  const catMacroFiltro = searchParams.get('cat_macro') ?? '';
  const categoriaFiltro = searchParams.get('categoria') ?? '';
  const vistaUrl = searchParams.get('vista');
  const vistaSelect =
    vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial'
      ? vistaUrl
      : 'por_vencer';

  const desdeHastaLabel = useMemo(() => {
    switch (rangeKey) {
      case 'all':
        return 'todos';
      case '30_only':
        return 'solo a 30 días';
      case '60_only':
        return 'solo a 60 días';
      case '90_only':
        return 'solo a 90 días';
      case '60_all':
        return '60 días';
      case '90_all':
        return '90 días';
      case '30_all':
      default:
        return '30 días';
    }
  }, [rangeKey]);

  const itemsFiltrados = useMemo(() => {
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const texto = [
        i.descripcion,
        i.presentacion ?? '',
        i.laboratorio ?? '',
        i.codigo_barras,
        i.producto_id_sistema,
        i.sucursal_nombre ?? '',
        String(i.sucursal_id),
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(q);
    });
  }, [items, busquedaTexto]);

  const totalesConsolidado = useMemo(() => {
    let cajasRestantes = 0;
    let cajasVendidasHist = 0;
    let lineasLiquidados = 0;
    for (const i of itemsFiltrados) {
      const r = Number(i.cantidad) || 0;
      const v = Number(i.cantidad_vendida_acumulada) || 0;
      cajasRestantes += r;
      cajasVendidasHist += v;
      if (r <= 0) lineasLiquidados += 1;
    }
    return {
      lineas: itemsFiltrados.length,
      cajasRestantes,
      cajasVendidasHist,
      cajasMovimientoTotal: cajasRestantes + cajasVendidasHist,
      lineasLiquidados,
    };
  }, [itemsFiltrados]);

  function buildParams(overrides: Record<string, string>) {
    const p = new URLSearchParams(searchParams.toString());
    p.set('consolidado', '1');
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '') p.delete(k);
      else p.set(k, v);
    }
    return p;
  }

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      if (daysParam === 365 && daysMinParam === 0) setRangeKey('all');
      else if (daysParam === 30 && daysMinParam === 0) setRangeKey('30_all');
      else if (daysParam === 30 && daysMinParam === 1) setRangeKey('30_only');
      else if (daysParam === 60 && daysMinParam === 31) setRangeKey('60_only');
      else if (daysParam === 60 && daysMinParam === 0) setRangeKey('60_all');
      else if (daysParam === 90 && daysMinParam === 61) setRangeKey('90_only');
      else if (daysParam === 90 && daysMinParam === 0) setRangeKey('90_all');
      else setRangeKey('all');

      const params = new URLSearchParams();
      params.set('days', String(daysParam));
      params.set('daysMin', String(daysMinParam));
      if (sucursalFiltro) params.set('sucursal', sucursalFiltro);
      if (catMacroFiltro) params.set('cat_macro', catMacroFiltro);
      if (categoriaFiltro) params.set('categoria', categoriaFiltro);
      if (vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial') {
        params.set('vista', vistaUrl);
      }

      const res = await fetch(`/api/vencimientos/por-vencer/consolidado?${params.toString()}`);
      const json = await res.json() as {
        data?: ConsolidadoItem[];
        cat_macros?: string[];
        categorias?: string[];
        sucursales?: Array<{ sucursal: number; nombrefantasia: string }>;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar consolidado');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      setCatMacros(json.cat_macros ?? []);
      setCategorias(json.categorias ?? []);
      setSucursales(json.sucursales ?? []);
    } catch {
      setError('Error al cargar consolidado');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function verAdmin() {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (!isAdminLikeRole(json?.data?.rol)) {
          router.replace('/vencimientos/por-vencer?days=365&daysMin=0');
          return;
        }
        setAutorizado(true);
      } catch {
        router.replace('/vencimientos/por-vencer?days=365&daysMin=0');
      }
    }
    void verAdmin();
  }, [router]);

  useEffect(() => {
    if (autorizado !== true) return;
    const currentDays = searchParams.get('days');
    const currentDaysMin = searchParams.get('daysMin');
    if (!currentDays || !currentDaysMin || searchParams.get('consolidado') !== '1') {
      const params = new URLSearchParams(searchParams.toString());
      if (!currentDays) params.set('days', '365');
      if (!currentDaysMin) params.set('daysMin', '0');
      params.set('consolidado', '1');
      router.replace(`/vencimientos/por-vencer/consolidado?${params.toString()}`);
      return;
    }
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, autorizado]);

  if (autorizado !== true) {
    return (
      <div className="py-12">
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/vencimientos/por-vencer?days=${searchParams.get('days') ?? '365'}&daysMin=${searchParams.get('daysMin') ?? '0'}${vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial' ? `&vista=${encodeURIComponent(vistaUrl)}` : ''}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {vistaSelect === 'por_vencer' && `Por vencer — consolidado (${desdeHastaLabel})`}
            {vistaSelect === 'vendido_parcial' &&
              `Por vencer — consolidado (${desdeHastaLabel}) · solo vendido parcial`}
            {vistaSelect === 'vendidos' && `Por vencer — consolidado (${desdeHastaLabel}) · solo liquidados`}
            {vistaSelect === 'vencidos' && `Vencidos — consolidado (${desdeHastaLabel} atrás)`}
          </h1>
        </div>
        <Link href="/vencimientos">
          <Button size="sm" variant="outline">
            Ver controles
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Filtros</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Listado multi-sucursal: no consulta ventas posteriores a la carga (solo la pantalla por sucursal lo hace).
                {vistaSelect === 'por_vencer' &&
                  ' Todas las sucursales · Incluye liquidados · Totales según filtros y búsqueda.'}
                {vistaSelect === 'vendidos' && 'Solo liquidados en el rango de vencimientos · Todas las sucursales.'}
                {vistaSelect === 'vendido_parcial' &&
                  'Restante en control, al menos 1 unidad vendida registrada y sin liquidar (vendido=0) · Todas las sucursales.'}
                {vistaSelect === 'vencidos' && 'Solo vencidos en los últimos N días (periodo) · Todas las sucursales.'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
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
                  className="min-w-[160px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
                    const nextKey = e.target.value as typeof rangeKey;
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
                    const p = buildParams({
                      days: String(nextDays),
                      daysMin: String(nextDaysMin),
                    });
                    setRangeKey(nextKey);
                    router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
                  }}
                  className="min-w-[120px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Sucursal</label>
                <select
                  value={sucursalFiltro}
                  onChange={(e) => {
                    const p = buildParams({
                      sucursal: e.target.value,
                      categoria: '',
                    });
                    router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
                  }}
                  className="min-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
                    const p = buildParams({
                      cat_macro: e.target.value,
                      categoria: '',
                    });
                    router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
                  }}
                  className="min-w-[180px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                >
                  <option value="">Todas</option>
                  {catMacros.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Categoría</label>
                <select
                  value={categoriaFiltro}
                  onChange={(e) => {
                    const p = buildParams({ categoria: e.target.value });
                    router.push(`/vencimientos/por-vencer/consolidado?${p.toString()}`);
                  }}
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                >
                  <option value="">Todas</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, sucursal..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                />
              </div>
              <Button size="sm" variant="secondary" onClick={cargar} disabled={loading}>
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
            {!loading && !error && itemsFiltrados.length > 0 ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
                <span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {totalesConsolidado.lineas}
                  </span>{' '}
                  líneas
                </span>
                <span>
                  Restantes:{' '}
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {totalesConsolidado.cajasRestantes.toFixed(0)}
                  </span>{' '}
                  cajas
                </span>
                <span>
                  Vendidas (hist.):{' '}
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {totalesConsolidado.cajasVendidasHist.toFixed(0)}
                  </span>{' '}
                  cajas
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                  Mov. total aprox.: {totalesConsolidado.cajasMovimientoTotal.toFixed(0)} · Liquidados:{' '}
                  {totalesConsolidado.lineasLiquidados}
                </span>
              </div>
            ) : null}
          </div>
          {!loading && !error && itemsFiltrados.length > 0 ? (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : itemsFiltrados.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500">
              {vistaSelect === 'vendidos' && 'No hay liquidados en ese rango.'}
              {vistaSelect === 'vendido_parcial' && 'No hay líneas con venta parcial sin liquidar en ese rango.'}
              {vistaSelect === 'vencidos' && 'No hay vencidos en ese rango.'}
              {vistaSelect === 'por_vencer' && 'No hay registros con esos filtros.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Sucursal
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Producto
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Cat. padrón
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Categoría
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Carga
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Vencimiento
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Restante
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Vendido
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Desc.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {itemsFiltrados.map((r) => {
                    const dias = diasHastaVencimiento(r.fecha_vencimiento);
                    const color = colorVencimiento(dias);
                    const vendHist = Number(r.cantidad_vendida_acumulada) || 0;
                    const rest = Number(r.cantidad) || 0;
                    const liquidado = rest <= 0;
                    return (
                      <tr
                        key={r.id}
                        style={estiloFilaProgresoVenta(rest, vendHist)}
                        className="transition-[filter] duration-150 hover:brightness-[0.97] dark:hover:brightness-[1.05]"
                      >
                        <td className="px-4 py-2 align-top text-xs text-gray-800 dark:text-gray-200">
                          {r.sucursal_nombre || `Sucursal ${r.sucursal_id}`}
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900 dark:text-gray-100">{r.descripcion}</p>
                            {liquidado ? (
                              <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                                Liquidado
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-200">
                            {r.presentacion} · {r.laboratorio}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-300">
                            {r.codigo_barras}
                          </p>
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-gray-700 dark:text-gray-300">
                          {r.cat_macro ?? '—'}
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-gray-700 dark:text-gray-300">
                          {r.categoria ?? '—'}
                        </td>
                        <td className="px-4 py-2 align-top text-xs whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {formatDateTime(r.fecha_registro)}
                        </td>
                        <td className="px-4 py-2 align-top text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800 dark:text-gray-200">
                              {formatDate(r.fecha_vencimiento)}
                            </span>
                            <span
                              className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}
                            >
                              {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                          {Number(r.cantidad ?? 0).toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                          {Number(r.cantidad_vendida_acumulada ?? 0).toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs">
                          {typeof r.descuento_aplicado === 'number' ? (
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                              -{Math.abs(r.descuento_aplicado)}%
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
