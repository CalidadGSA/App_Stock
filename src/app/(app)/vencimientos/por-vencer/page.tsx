'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { ArrowLeft, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

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
  accion_observacion?: string | null;
  venta_posterior_a_carga?: boolean;
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
  const [gruposExpandidos, setGruposExpandidos] = useState<Record<string, boolean>>({});
  const [obsLocal, setObsLocal] = useState<Record<string, string>>({});
  const [guardandoObsId, setGuardandoObsId] = useState<string | null>(null);
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

  type FilaAgrupada =
    | { tipo: 'uno'; item: PorVencerItem }
    | { tipo: 'grupo'; key: string; items: PorVencerItem[] };

  const filasAgrupadas = useMemo((): FilaAgrupada[] => {
    const map = new Map<string, PorVencerItem[]>();
    for (const i of itemsFiltrados) {
      const k = `${i.producto_id_sistema}\t${i.fecha_vencimiento}`;
      const arr = map.get(k) ?? [];
      arr.push(i);
      map.set(k, arr);
    }
    const filas: FilaAgrupada[] = [];
    for (const [, arr] of map) {
      if (arr.length === 1) {
        filas.push({ tipo: 'uno', item: arr[0]! });
      } else {
        filas.push({
          tipo: 'grupo',
          key: `${arr[0]!.producto_id_sistema}-${arr[0]!.fecha_vencimiento}`,
          items: arr,
        });
      }
    }
    filas.sort((a, b) => {
      const fa = a.tipo === 'uno' ? a.item.fecha_vencimiento : a.items[0]!.fecha_vencimiento;
      const fb = b.tipo === 'uno' ? b.item.fecha_vencimiento : b.items[0]!.fecha_vencimiento;
      return fa.localeCompare(fb);
    });
    return filas;
  }, [itemsFiltrados]);

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
      setObsLocal({});
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

  async function reducirCarga(detalleId: string, cantidadDisponible: number) {
    const max = Math.max(0, Math.floor(Number(cantidadDisponible) || 0));
    if (max <= 0) {
      setError('Sin cantidad para quitar.');
      return;
    }
    const ingresado = window.prompt(
      `¿Cuántas unidades quitás? (error de carga, máx ${max})`,
      String(max)
    );
    if (ingresado == null) return;
    const cantidad = parseInt(ingresado, 10);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > max) {
      setError(`Cantidad entre 1 y ${max}.`);
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/vencimientos/por-vencer/reducir-carga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detalle_id: detalleId, cantidad }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Error al quitar cantidad');
        return;
      }
      await cargar();
    } catch {
      setError('Error al quitar cantidad');
    }
  }

  function textoObs(item: PorVencerItem) {
    if (obsLocal[item.id] !== undefined) return obsLocal[item.id];
    return String(item.accion_observacion ?? '');
  }

  async function guardarObservacion(item: PorVencerItem) {
    const texto = textoObs(item).trim();
    setGuardandoObsId(item.id);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/por-vencer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, accion_observacion: texto }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        accion_observacion?: string | null;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al guardar observación');
        return;
      }
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id ? { ...x, accion_observacion: json.accion_observacion ?? null } : x
        )
      );
      setObsLocal((prev) => {
        const n = { ...prev };
        delete n[item.id];
        return n;
      });
    } catch {
      setError('Error al guardar observación');
    } finally {
      setGuardandoObsId(null);
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
                  placeholder="Producto, código, id, laboratorio…"
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
            {!loading && !error && filasAgrupadas.length > 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
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
          ) : filasAgrupadas.length === 0 ? (
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
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      Acción / observación
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filasAgrupadas.map((fila) => {
                    if (fila.tipo === 'uno') {
                      const r = fila.item;
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
                              {r.codigo_barras} · ID {r.producto_id_sistema}
                            </p>
                            {r.venta_posterior_a_carga ? (
                              <p className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                Venta posterior a la carga
                              </p>
                            ) : null}
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
                          <td className="px-4 py-2 align-top">
                            <textarea
                              rows={2}
                              value={textoObs(r)}
                              onChange={(e) =>
                                setObsLocal((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              className="w-full min-w-[190px] resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
                              placeholder="Acción tomada..."
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              className="mt-1"
                              disabled={guardandoObsId === r.id}
                              onClick={() => void guardarObservacion(r)}
                            >
                              {guardandoObsId === r.id ? 'Guardando…' : 'Guardar'}
                            </Button>
                          </td>
                          <td className="px-4 py-2 align-top text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={liquidado}
                                onClick={() => void eliminarRegistro(r.id, Number(r.cantidad ?? 0))}
                              >
                                Vendido
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="px-2"
                                title="Quitar por error de carga"
                                disabled={liquidado}
                                onClick={() => void reducirCarga(r.id, Number(r.cantidad ?? 0))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const grp = fila.items;
                    const key = fila.key;
                    const exp = gruposExpandidos[key] ?? false;
                    const restG = grp.reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
                    const vendG = grp.reduce((s, x) => s + (Number(x.cantidad_vendida_acumulada) || 0), 0);
                    const liquidadoG = restG <= 0;
                    const primero = grp[0]!;
                    const dias = diasHastaVencimiento(primero.fecha_vencimiento);
                    const color = colorVencimiento(dias);
                    const desc0 = primero.descuento_aplicado;
                    const descTodosIguales = grp.every(
                      (x) => x.descuento_aplicado === desc0
                    );

                    return (
                      <Fragment key={key}>
                        <tr
                          style={estiloFilaProgresoVenta(restG, vendG)}
                          className="transition-[filter] duration-150 hover:brightness-[0.97] dark:hover:brightness-[1.05]"
                        >
                          <td className="px-4 py-2 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-gray-900 dark:text-gray-100">{primero.descripcion}</p>
                              <span className="inline-flex rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100">
                                {grp.length} líneas
                              </span>
                              {liquidadoG ? (
                                <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                                  Liquidado
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm text-gray-900 dark:text-gray-200">
                              {primero.presentacion} · {primero.laboratorio}
                            </p>
                            <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-300">
                              {primero.codigo_barras} · ID {primero.producto_id_sistema}
                            </p>
                            {grp.some((x) => x.venta_posterior_a_carga) ? (
                              <p className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                Venta posterior a la carga
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 align-top text-xs text-gray-700 dark:text-gray-300">
                            {primero.categoria ?? '-'}
                          </td>
                          <td className="px-4 py-2 align-top text-xs text-gray-600 dark:text-gray-400">
                            Varias cargas
                          </td>
                          <td className="px-4 py-2 align-top text-xs">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-800 dark:text-gray-200">{formatDate(primero.fecha_vencimiento)}</span>
                              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                                {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {restG.toFixed(0)}
                          </td>
                          <td className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {vendG.toFixed(0)}
                          </td>
                          <td className="px-4 py-2 align-top text-right text-xs">
                            {descTodosIguales && typeof desc0 === 'number' ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                                -{Math.abs(desc0)}%
                              </span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top text-xs text-gray-500 dark:text-gray-400">
                            Editá por línea
                          </td>
                          <td className="px-4 py-2 align-top text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gap-1"
                              onClick={() =>
                                setGruposExpandidos((p) => ({ ...p, [key]: !exp }))
                              }
                            >
                              {exp ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              Líneas
                            </Button>
                          </td>
                        </tr>
                        {exp
                          ? grp.map((r) => {
                              const d = diasHastaVencimiento(r.fecha_vencimiento);
                              const col = colorVencimiento(d);
                              const vh = Number(r.cantidad_vendida_acumulada) || 0;
                              const rest = Number(r.cantidad) || 0;
                              const liq = rest <= 0;
                              return (
                                <tr
                                  key={r.id}
                                  className="bg-slate-50/90 dark:bg-slate-900/40"
                                >
                                  <td className="px-4 py-2 pl-8 align-top text-xs text-gray-600 dark:text-gray-400">
                                    Línea · control {r.control_id.slice(0, 8)}…
                                  </td>
                                  <td className="px-4 py-2 align-top text-xs text-gray-500 dark:text-gray-500">
                                    {r.categoria ?? '-'}
                                  </td>
                                  <td className="px-4 py-2 align-top text-xs whitespace-nowrap text-gray-600 dark:text-gray-400">
                                    {r.fecha_registro ? formatDateTime(r.fecha_registro) : '—'}
                                  </td>
                                  <td className="px-4 py-2 align-top text-xs">
                                    <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${col}`}>
                                      {formatDate(r.fecha_vencimiento)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 align-top text-right text-xs">{rest.toFixed(0)}</td>
                                  <td className="px-4 py-2 align-top text-right text-xs">{vh.toFixed(0)}</td>
                                  <td className="px-4 py-2 align-top text-right text-xs">
                                    {typeof r.descuento_aplicado === 'number' ? (
                                      <span className="text-emerald-700 dark:text-emerald-300">
                                        -{Math.abs(r.descuento_aplicado)}%
                                      </span>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                  <td className="px-4 py-2 align-top">
                                    <textarea
                                      rows={2}
                                      value={textoObs(r)}
                                      onChange={(e) =>
                                        setObsLocal((prev) => ({ ...prev, [r.id]: e.target.value }))
                                      }
                                      className="w-full min-w-[180px] resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
                                      placeholder="Acción tomada..."
                                    />
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="mt-1"
                                      disabled={guardandoObsId === r.id}
                                      onClick={() => void guardarObservacion(r)}
                                    >
                                      {guardandoObsId === r.id ? 'Guardando…' : 'Guardar'}
                                    </Button>
                                    {r.venta_posterior_a_carga ? (
                                      <p className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                        Venta posterior a la carga
                                      </p>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-2 align-top text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={liq}
                                        onClick={() => void eliminarRegistro(r.id, Number(r.cantidad ?? 0))}
                                      >
                                        Vendido
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="px-2"
                                        title="Quitar por error de carga"
                                        disabled={liq}
                                        onClick={() => void reducirCarga(r.id, Number(r.cantidad ?? 0))}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          : null}
                      </Fragment>
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

