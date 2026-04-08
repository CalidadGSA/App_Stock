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

interface PorVencerItem {
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
  cantidad_vendida_acumulada?: number;
  vendido?: number;
  cat_macro: string | null;
  categoria: string | null;
  descuento_aplicado?: number | null;
}

export default function PorVencerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PorVencerItem[]>([]);
  const [catMacros, setCatMacros] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);
  const [daysMin, setDaysMin] = useState(0);
  const [catMacroFiltro, setCatMacroFiltro] = useState<string>('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [rol, setRol] = useState<'admin' | 'operador_sucursal'>('operador_sucursal');
  const [rangeKey, setRangeKey] = useState<
    'all' | '30_all' | '60_all' | '90_all' | '30_only' | '60_only' | '90_only'
  >('all');

  const vistaUrl = searchParams.get('vista');
  const vistaSelect =
    vistaUrl === 'vendidos' || vistaUrl === 'vencidos' ? vistaUrl : 'por_vencer';

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

  const tituloPrincipal = useMemo(() => {
    const base = `Productos próximos a vencer (${desdeHastaLabel})`;
    if (vistaSelect === 'vendidos') return `${base} — solo liquidados`;
    if (vistaSelect === 'vencidos') return `Productos vencidos (${desdeHastaLabel} hacia atrás)`;
    return base;
  }, [desdeHastaLabel, vistaSelect]);

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
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(q);
    });
  }, [items, busquedaTexto]);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      setDays(daysParam);
      setDaysMin(daysMinParam);
      // Determinar selección actual según (days, daysMin)
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
      if (catMacroFiltro) {
        params.set('cat_macro', catMacroFiltro);
      }
      if (categoriaFiltro) {
        params.set('categoria', categoriaFiltro);
      }
      if (vistaUrl === 'vendidos' || vistaUrl === 'vencidos') {
        params.set('vista', vistaUrl);
      }
      const res = await fetch(`/api/vencimientos/por-vencer?${params.toString()}`);
      const json = await res.json() as {
        data?: PorVencerItem[];
        cat_macros?: string[];
        categorias?: string[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar productos por vencer');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      setCatMacros(json.cat_macros ?? []);
      setCategorias(json.categorias ?? []);
    } catch {
      setError('Error al cargar productos por vencer');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const currentDays = searchParams.get('days');
    const currentDaysMin = searchParams.get('daysMin');
    if (!currentDays || !currentDaysMin) {
      const params = new URLSearchParams(searchParams.toString());
      if (!currentDays) params.set('days', '365');
      if (!currentDaysMin) params.set('daysMin', '0');
      router.replace(`/vencimientos/por-vencer?${params.toString()}`);
      return;
    }
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, catMacroFiltro, categoriaFiltro]);

  useEffect(() => {
    async function cargarRol() {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (json?.data?.rol === 'admin') {
          setRol('admin');
        }
      } catch {
        // noop
      }
    }
    void cargarRol();
  }, []);

  async function eliminarRegistro(id: string, cantidadDisponible: number) {
    const max = Math.max(0, Math.floor(Number(cantidadDisponible) || 0));
    if (max <= 0) {
      setError('El registro no tiene cantidad disponible para marcar como vendido.');
      return;
    }
    const ingresado = window.prompt(`¿Cuántas unidades se vendieron? (1 a ${max})`, '1');
    if (ingresado == null) return;
    const cantidad = parseInt(ingresado, 10);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > max) {
      setError(`Ingresá una cantidad válida entre 1 y ${max}.`);
      return;
    }
    try {
      const params = new URLSearchParams({
        id,
        cantidad: String(cantidad),
      });
      const res = await fetch(`/api/vencimientos/por-vencer?${params.toString()}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; cantidad_restante?: number };
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar el registro');
        return;
      }
      const restante = Number(json.cantidad_restante ?? 0);
      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                cantidad: restante,
                vendido: restante <= 0 ? 1 : Number(x.vendido) || 0,
                cantidad_vendida_acumulada:
                  (Number(x.cantidad_vendida_acumulada) || 0) + cantidad,
              }
            : x
        )
      );
    } catch {
      setError('Error al eliminar el registro');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Volver"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{tituloPrincipal}</h1>
        </div>
        <div className="flex items-center gap-2">
          {rol === 'admin' && (
            <>
              <Link
                href={`/vencimientos/por-vencer/consolidado?consolidado=1&days=${searchParams.get('days') ?? '365'}&daysMin=${searchParams.get('daysMin') ?? '0'}${vistaUrl === 'vendidos' || vistaUrl === 'vencidos' ? `&vista=${encodeURIComponent(vistaUrl)}` : ''}`}
              >
                <Button size="sm" variant="secondary">
                  Consolidado
                </Button>
              </Link>
              <Link href="/vencimientos/descuentos">
                <Button size="sm" variant="outline">
                  Descuentos
                </Button>
              </Link>
            </>
          )}
          <Link href="/vencimientos">
            <Button size="sm" variant="outline">
              Ver controles
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Filtros</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {vistaSelect === 'por_vencer' &&
                  'Por vencer: fechas desde hoy según el periodo. Incluye liquidados (restante 0).'}
                {vistaSelect === 'vendidos' &&
                  'Solo líneas liquidadas dentro del rango de fechas de vencimiento (según periodo).'}
                {vistaSelect === 'vencidos' &&
                  'Solo productos ya vencidos: fechas de vencimiento en los últimos N días (según periodo), antes de hoy.'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
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
                  className="min-w-[160px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                >
                  <option value="por_vencer">Por vencer</option>
                  <option value="vendidos">Solo vendidos</option>
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
                    const params = new URLSearchParams(searchParams.toString());
                      params.set('days', String(nextDays));
                      params.set('daysMin', String(nextDaysMin));
                      setRangeKey(nextKey);
                    router.push(`/vencimientos/por-vencer?${params.toString()}`);
                  }}
                  className="min-w-[120px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, laboratorio..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cat. Macro</label>
                <select
                  value={catMacroFiltro}
                  onChange={(e) => {
                    setCatMacroFiltro(e.target.value);
                    setCategoriaFiltro('');
                  }}
                  className="min-w-[180px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                >
                  <option value="">Todas</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
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
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
            {!loading && !error && itemsFiltrados.length > 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Color de fila: progreso de venta cada 10 % (rojo → verde) según vendido ÷ (restante + vendido).
              </p>
            ) : null}
          </div>
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
              {vistaSelect === 'vendidos' && 'No hay productos liquidados en ese rango.'}
              {vistaSelect === 'vencidos' && 'No hay productos vencidos en ese rango.'}
              {vistaSelect === 'por_vencer' && 'No hay productos por vencer con esos filtros.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Producto
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
                      Descuento
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Acciones
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
                          {r.categoria ?? '-'}
                        </td>
                        <td className="px-4 py-2 align-top text-xs whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {formatDateTime(r.fecha_registro)}
                        </td>
                        <td className="px-4 py-2 align-top text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800 dark:text-gray-200">{formatDate(r.fecha_vencimiento)}</span>
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                              {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                          {Number(r.cantidad ?? 0).toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                          {vendHist.toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs">
                          {typeof r.descuento_aplicado === 'number' ? (
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                              -{Math.abs(r.descuento_aplicado)}%
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 align-top text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={liquidado}
                            onClick={() => void eliminarRegistro(r.id, Number(r.cantidad ?? 0))}
                          >
                            Vendido
                          </Button>
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

