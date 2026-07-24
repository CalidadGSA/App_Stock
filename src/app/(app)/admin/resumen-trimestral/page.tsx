'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarClock,
  ClipboardList,
  AlertTriangle,
  Timer,
  PackageX,
  FileStack,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/spinner';
import {
  formatDate,
  formatPorcentaje,
  formatRangoFechasLargo,
  porcentajeDesdeRatio,
} from '@/lib/utils';
import type {
  ResumenTrimestralSeleccion,
  ResumenTrimestralSucursalRow,
} from '@/app/api/admin/resumen-trimestral/route';
import type { TrimestreDbOpcion } from '@/lib/inventario/trimestre-periodo';
import ResumenTrimestralListMobile from '@/components/admin/ResumenTrimestralListMobile';

function parseAnioUrl(value: string | null): number | null {
  const n = parseInt(String(value ?? ''), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return null;
}

function parseCuatrimestreUrl(value: string | null): number | null {
  const n = parseInt(String(value ?? ''), 10);
  if (n >= 1 && n <= 4) return n;
  return null;
}

interface ResumenTrimestralData {
  hoy: string;
  fecha_corte: string;
  trimestre: string;
  seleccion: ResumenTrimestralSeleccion;
  opciones_trimestre: TrimestreDbOpcion[];
  fecha_inicio: string;
  fecha_fin: string;
  totales: {
    inventariados: number;
    pendientes: number;
    total: number;
    porcentaje: number;
    productos_con_diferencia: number;
    productos_con_diferencia_global: number;
    productos_inventariados_auditoria_global: number;
    productos_con_diferencia_auditoria_global: number;
    productos_mal_contados: number;
    productos_mal_contados_global?: number;
    porcentaje_diferencias: number;
    porcentaje_diferencias_auditoria: number;
    por_vencer_trimestre: number;
    por_vencer_30_dias: number;
    por_vencer_31_60_dias: number;
    por_vencer_61_90_dias: number;
    productos_vencidos_trimestre: number;
    productos_vencidos_trimestre_global?: number;
    unidades_vencidos_vendidas: number;
    unidades_vencidos_vendidas_global?: number;
    productos_cargados_vencimientos: number;
  };
  sucursales: ResumenTrimestralSucursalRow[];
}

const MESES_TRIM = ['Ene–Mar', 'Abr–Jun', 'Jul–Sep', 'Oct–Dic'];

type SortKey = keyof Pick<
  ResumenTrimestralSucursalRow,
  | 'sucursal_nombre'
  | 'porcentaje'
  | 'inventariados'
  | 'pendientes'
  | 'total'
  | 'productos_con_diferencia'
  | 'productos_mal_contados'
  | 'productos_cargados_vencimientos'
  | 'por_vencer_trimestre'
  | 'por_vencer_30_dias'
  | 'por_vencer_31_60_dias'
  | 'por_vencer_61_90_dias'
  | 'productos_vencidos_trimestre'
  | 'unidades_vencidos_vendidas'
>;

type SortDir = 'asc' | 'desc';

/** Progreso de inventario trimestral (0–1); sin base asignada → -1 para ir al final. */
function ratioProgresoInventario(row: ResumenTrimestralSucursalRow): number {
  const total = Number(row.total);
  if (total <= 0) return -1;
  return Number(row.inventariados) / total;
}

function sinBaseAsignada(row: ResumenTrimestralSucursalRow): boolean {
  return Number(row.total) <= 0;
}

function compararFilas(
  a: ResumenTrimestralSucursalRow,
  b: ResumenTrimestralSucursalRow,
  key: SortKey,
  dir: SortDir
): number {
  if (
    (key === 'inventariados' || key === 'porcentaje') &&
    sinBaseAsignada(a) !== sinBaseAsignada(b)
  ) {
    return sinBaseAsignada(a) ? 1 : -1;
  }

  let cmp = 0;
  if (key === 'sucursal_nombre') {
    cmp = a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es', { sensitivity: 'base' });
  } else if (key === 'inventariados') {
    cmp = ratioProgresoInventario(a) - ratioProgresoInventario(b);
    if (cmp === 0) cmp = Number(a.inventariados) - Number(b.inventariados);
  } else if (key === 'porcentaje') {
    cmp = Number(a.porcentaje) - Number(b.porcentaje);
  } else {
    cmp = Number(a[key]) - Number(b[key]);
  }

  if (cmp === 0 && key !== 'sucursal_nombre') {
    cmp = a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es', { sensitivity: 'base' });
  }
  return dir === 'asc' ? cmp : -cmp;
}

export default function ResumenTrimestralPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ResumenTrimestralContent />
    </Suspense>
  );
}

function ResumenTrimestralContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ResumenTrimestralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [anioSel, setAnioSel] = useState<number | null>(() =>
    parseAnioUrl(searchParams.get('anio'))
  );
  const [cuatrimestreSel, setCuatrimestreSel] = useState<number | null>(() =>
    parseCuatrimestreUrl(searchParams.get('cuatrimestre'))
  );
  const [sortKey, setSortKey] = useState<SortKey>('sucursal_nombre');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function alternarOrden(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'sucursal_nombre' ? 'asc' : 'desc');
  }

  const cargar = useCallback(
    async (anio?: number | null, cuatrimestre?: number | null) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (anio != null && cuatrimestre != null) {
          params.set('anio', String(anio));
          params.set('cuatrimestre', String(cuatrimestre));
        }
        const qs = params.toString();
        const res = await fetch(
          `/api/admin/resumen-trimestral${qs ? `?${qs}` : ''}`
        );
        const json = await res.json();
        if (res.status === 403) {
          router.replace('/dashboard');
          return;
        }
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar el resumen');
          return;
        }
        const payload = json.data as ResumenTrimestralData | null;
        setData(payload ?? null);
        if (payload?.seleccion) {
          setAnioSel(payload.seleccion.anio);
          setCuatrimestreSel(payload.seleccion.cuatrimestre);
          // Reflejar período aplicado en la URL (sin recargar la página).
          const next = new URLSearchParams();
          next.set('anio', String(payload.seleccion.anio));
          next.set('cuatrimestre', String(payload.seleccion.cuatrimestre));
          router.replace(`/admin/resumen-trimestral?${next.toString()}`, {
            scroll: false,
          });
        }
      } catch {
        setError('Error al cargar el resumen trimestral');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    const anioUrl = parseAnioUrl(searchParams.get('anio'));
    const cuaUrl = parseCuatrimestreUrl(searchParams.get('cuatrimestre'));
    void cargar(anioUrl, cuaUrl);
    // Solo al montar: Aplicar llama cargar() a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aniosDisponibles = useMemo(() => {
    const set = new Set<number>();
    for (const o of data?.opciones_trimestre ?? []) {
      set.add(o.anio);
    }
    if (anioSel != null) set.add(anioSel);
    const y = new Date().getFullYear();
    set.add(y);
    set.add(y - 1);
    return Array.from(set).sort((a, b) => b - a);
  }, [data?.opciones_trimestre, anioSel]);

  function aplicarPeriodo() {
    if (anioSel == null || cuatrimestreSel == null) return;
    void cargar(anioSel, cuatrimestreSel);
  }

  const sucursalesOrdenadas = useMemo(() => {
    const copia = [...(data?.sucursales ?? [])];
    copia.sort((a, b) => compararFilas(a, b, sortKey, sortDir));
    return copia;
  }, [data?.sucursales, sortKey, sortDir]);

  if (loading && !data) return <PageSpinner />;

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
        <p className="text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">Sin datos disponibles.</p>
    );
  }

  const periodoLabel =
    data.fecha_inicio && data.fecha_fin
      ? formatRangoFechasLargo(data.fecha_inicio, data.fecha_fin)
      : '—';

  const difTotal = data.totales.productos_con_diferencia;
  const invAuditoria = data.totales.productos_inventariados_auditoria_global ?? 0;
  const difAuditoria = data.totales.productos_con_diferencia_auditoria_global ?? 0;
  const malContados = data.totales.productos_mal_contados_global ?? data.totales.productos_mal_contados ?? 0;

  function encabezadoOrdenable(
    key: SortKey,
    label: string,
    align: 'left' | 'right' = 'left'
  ) {
    const activo = sortKey === key;
    const Icon = activo ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={`px-2 py-2 align-bottom ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => alternarOrden(key)}
          title={label}
          className={`inline-flex max-w-full items-center gap-0.5 text-left leading-tight hover:text-gray-800 dark:hover:text-gray-200 ${
            align === 'right' ? 'ml-auto flex-row-reverse text-right' : ''
          } ${activo ? 'text-gray-900 dark:text-gray-100' : ''}`}
        >
          <span className="whitespace-normal">{label}</span>
          <Icon className={`h-3 w-3 shrink-0 ${activo ? 'opacity-100' : 'opacity-40'}`} />
        </button>
      </th>
    );
  }

  function celdaDiferencia(conDif: number, inventariados: number) {
    if (inventariados <= 0) {
      return <span className="tabular-nums">{conDif}</span>;
    }
    const pct = formatPorcentaje(porcentajeDesdeRatio(conDif, inventariados));
    return (
      <span className="inline-flex flex-col items-end leading-tight tabular-nums">
        <span>{conDif}</span>
        <span className="text-[10px] font-normal text-gray-500 dark:text-gray-400">({pct}%)</span>
      </span>
    );
  }

  const periodoCerrado =
    Boolean(data.fecha_fin) && data.hoy > data.fecha_fin;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            aria-label="Volver"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Resumen trimestral por sucursal
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Inventario diario, diferencias, vencimientos cargados y stock vencido en el período
              seleccionado.
            </p>
            <p className="mt-2 text-sm font-medium text-blue-700 dark:text-blue-400">
              {data.seleccion?.etiqueta ?? data.trimestre}
              <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                ({periodoLabel})
              </span>
            </p>
            {loading ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Actualizando período…
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Año</label>
            <select
              value={anioSel ?? ''}
              onChange={(e) => setAnioSel(parseInt(e.target.value, 10) || null)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
            >
              {aniosDisponibles.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Trimestre
            </label>
            <select
              value={cuatrimestreSel ?? ''}
              onChange={(e) => setCuatrimestreSel(parseInt(e.target.value, 10) || null)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  {q}° ({MESES_TRIM[q - 1]})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={aplicarPeriodo}
            disabled={loading || anioSel == null || cuatrimestreSel == null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Cargando…' : 'Aplicar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {data.sucursales.length}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Sucursales activas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {formatPorcentaje(data.totales.porcentaje)}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Inventario cadena ({data.totales.inventariados}/{data.totales.total})
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <PackageX className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {formatPorcentaje(data.totales.porcentaje_diferencias)}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Productos con diferencia cadena ({difTotal}/{data.totales.inventariados})
                <span className="block text-[10px] font-normal text-gray-400 dark:text-gray-500">
                  Excluye controles de auditoría
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {formatPorcentaje(data.totales.porcentaje_diferencias_auditoria ?? 0)}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Diferencia auditoría ({difAuditoria}/{invAuditoria})
                <span className="block text-[10px] font-normal text-gray-400 dark:text-gray-500">
                  Solo controles con origen auditoría
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <PackageX className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {formatPorcentaje(porcentajeDesdeRatio(malContados, difAuditoria))}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Productos mal contados ({malContados}/{difAuditoria})
                <span className="block text-[10px] font-normal text-gray-400 dark:text-gray-500">
                  Sobre diferencias de auditoría · ajuste sucursal inverso al auditor
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {data.totales.por_vencer_trimestre}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Unidades por vencer hasta fin del trimestre
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {data.totales.productos_vencidos_trimestre_global ??
                  data.totales.productos_vencidos_trimestre}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Vencidos con saldo (fecha de venc. anterior a hoy, no vendido del todo)
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
              <FileStack className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {data.totales.productos_cargados_vencimientos}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Productos cargados en controles de vencimientos
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {data.totales.por_vencer_30_dias}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {periodoCerrado
                  ? 'Por vencer ≤30 d (solo aplica al trimestre vigente)'
                  : 'Vencen en los próximos 30 días (o hasta fin del trimestre)'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {data.totales.por_vencer_31_60_dias}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {periodoCerrado
                  ? 'Por vencer 31–60 d (solo aplica al trimestre vigente)'
                  : 'Vencen entre los próximos 31 y 60 días (o hasta fin del trimestre)'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {data.totales.por_vencer_61_90_dias}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {periodoCerrado
                  ? 'Por vencer 61–90 d (solo aplica al trimestre vigente)'
                  : 'Vencen entre los próximos 61 y 90 días (o hasta fin del trimestre)'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Detalle por sucursal</h2>
        </CardHeader>
        <CardContent className="p-0">
          {data.sucursales.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400">
              No hay sucursales activas o sin datos para el período seleccionado.
            </p>
          ) : (
            <>
              <div className="md:hidden">
                <ResumenTrimestralListMobile
                  rows={sucursalesOrdenadas}
                  trimestreActual={data.trimestre}
                />
              </div>
              <div className="hidden md:block">
                <table className="w-full table-fixed text-xs lg:text-sm">
                  <colgroup>
                    <col className="w-[13%]" />
                    <col className="w-[14%]" />
                    <col className="w-[6%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400 lg:text-xs">
                      {encabezadoOrdenable('sucursal_nombre', 'Sucursal')}
                      {encabezadoOrdenable('inventariados', 'Inv. trim.')}
                      {encabezadoOrdenable('porcentaje', '%', 'right')}
                      {encabezadoOrdenable('productos_con_diferencia', 'Con dif.', 'right')}
                      {encabezadoOrdenable('productos_mal_contados', 'Mal cont.', 'right')}
                      {encabezadoOrdenable('productos_cargados_vencimientos', 'Venc. carg.', 'right')}
                      {encabezadoOrdenable('por_vencer_trimestre', 'P. vencer', 'right')}
                      {encabezadoOrdenable('por_vencer_30_dias', '≤30 d', 'right')}
                      {encabezadoOrdenable('por_vencer_31_60_dias', '31–60', 'right')}
                      {encabezadoOrdenable('por_vencer_61_90_dias', '61–90', 'right')}
                      {encabezadoOrdenable('productos_vencidos_trimestre', 'Vencidos', 'right')}
                      {encabezadoOrdenable('unidades_vencidos_vendidas', 'Vendidos', 'right')}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {sucursalesOrdenadas.map((row) => (
                      <tr
                        key={row.sucursal_id}
                        className="hover:bg-gray-50/80 dark:hover:bg-gray-900/40"
                      >
                        <td className="px-2 py-2.5 align-top">
                          <p
                            className="truncate font-medium text-gray-900 dark:text-gray-100"
                            title={row.sucursal_nombre}
                          >
                            {row.sucursal_nombre}
                          </p>
                        </td>
                        <td className="px-2 py-2.5 align-top">
                          {row.total > 0 ? (
                            <>
                              <div className="h-1.5 w-full min-w-0 rounded bg-gray-100 dark:bg-gray-800">
                                <div
                                  className="h-1.5 rounded bg-blue-600"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, row.porcentaje))}%`,
                                  }}
                                />
                              </div>
                              <p className="mt-0.5 truncate text-[10px] leading-tight text-gray-500 dark:text-gray-400 lg:text-xs">
                                {row.inventariados}/{row.total}
                                {row.pendientes > 0 ? ` · ${row.pendientes} pend.` : ''}
                              </p>
                            </>
                          ) : (
                            <span className="text-[10px] text-gray-400 lg:text-xs">Sin base</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums">
                          {row.total > 0 ? (
                            <span className="font-medium">{row.porcentaje}%</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top">
                          <span
                            className={
                              row.productos_con_diferencia > 0
                                ? 'font-medium text-violet-700 dark:text-violet-400'
                                : 'text-gray-500'
                            }
                          >
                            {celdaDiferencia(row.productos_con_diferencia, row.inventariados)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums">
                          <span
                            className={
                              row.productos_mal_contados > 0
                                ? 'font-medium text-violet-700 dark:text-violet-400'
                                : 'text-gray-500'
                            }
                          >
                            {row.productos_mal_contados}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-700 dark:text-gray-200">
                          {row.productos_cargados_vencimientos}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums">
                          <span
                            className={
                              row.por_vencer_trimestre > 0
                                ? 'font-semibold text-amber-700 dark:text-amber-400'
                                : 'text-gray-500'
                            }
                          >
                            {row.por_vencer_trimestre}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-700 dark:text-gray-200">
                          {row.por_vencer_30_dias}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-700 dark:text-gray-200">
                          {row.por_vencer_31_60_dias}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-700 dark:text-gray-200">
                          {row.por_vencer_61_90_dias}
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums">
                          <span
                            className={
                              row.productos_vencidos_trimestre > 0
                                ? 'font-medium text-red-700 dark:text-red-400'
                                : 'text-gray-500'
                            }
                          >
                            {row.productos_vencidos_trimestre}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right align-top tabular-nums">
                          <span
                            className={
                              row.unidades_vencidos_vendidas > 0
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : 'text-gray-500'
                            }
                          >
                            {row.unidades_vencidos_vendidas}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold dark:border-gray-600 dark:bg-gray-900/60 lg:text-sm">
                      <td className="px-2 py-2 text-gray-900 dark:text-gray-100" colSpan={3}>
                        Totales
                      </td>
                      <td className="px-2 py-2 text-right">
                        {celdaDiferencia(difTotal, data.totales.inventariados)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <span
                          className={
                            malContados > 0
                              ? 'font-medium text-violet-700 dark:text-violet-400'
                              : ''
                          }
                        >
                          {malContados}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.productos_cargados_vencimientos}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.por_vencer_trimestre}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.por_vencer_30_dias}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.por_vencer_31_60_dias}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.por_vencer_61_90_dias}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.productos_vencidos_trimestre_global ??
                          data.totales.productos_vencidos_trimestre}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {data.totales.unidades_vencidos_vendidas_global ??
                          data.totales.unidades_vencidos_vendidas}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
