'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatDate,
  formatDateTime,
  formatMoneda,
  diasHastaVencimiento,
  colorVencimiento,
  estiloFilaProgresoVenta,
  fechaHoyArgentinaYmd,
  formatDateForFilename,
} from '@/lib/utils';
import {
  detectarRangeKey,
  etiquetaPeriodoParaRangeKey,
  type RangePeriodoKey,
} from '@/lib/vencimientos/por-vencer-periodo-meses';
import { ArrowLeft, Filter } from 'lucide-react';
import { clientHasPermission } from '@/lib/auth/permissions-client';
import {
  MESES_CALENDARIO,
  opcionesAnioVencimiento,
  validarAnioVencFiltro,
  validarMesVencFiltro,
} from '@/lib/vencimientos-mes-anio-filtro';
import ConsolidadoListMobile from '@/components/vencimientos/ConsolidadoListMobile';
import { PorVencerConsolidadoFiltrosPanel } from '@/components/vencimientos/PorVencerConsolidadoFiltrosPanel';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_STICKY_THEAD,
  DATATABLE_PAGE_ROOT,
} from '@/components/list/datatable-classes';
import { DatatableListSection } from '@/components/list/DatatableListSection';
import {
  usePaginacionServidor,
} from '@/components/list/datatable-pagination';
import { tamPaginaToPageSizeParam } from '@/lib/api/pagination';

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
  precio?: number | null;
  monto?: number | null;
}

export default function PorVencerConsolidadoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ConsolidadoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalesApi, setTotalesApi] = useState({
    lineas: 0,
    cajasRestantes: 0,
    cajasVendidasHist: 0,
    cajasMovimientoTotal: 0,
    lineasLiquidados: 0,
    montoTotal: 0,
  });
  const [sucursales, setSucursales] = useState<Array<{ sucursal: number; nombrefantasia: string }>>([]);
  const [catMacros, setCatMacros] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  /** Años y meses con líneas (los meses, del año elegido); vacío = todavía no cargó. */
  const [aniosConDatos, setAniosConDatos] = useState<number[]>([]);
  const [mesesConDatos, setMesesConDatos] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [rangeKey, setRangeKey] = useState<RangePeriodoKey>('all');

  const sucursalFiltro = searchParams.get('sucursal') ?? '';
  const catMacroFiltro = searchParams.get('cat_macro') ?? '';
  const categoriaFiltro = searchParams.get('categoria') ?? '';
  const vistaUrl = searchParams.get('vista');
  const vistaSelect =
    vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial'
      ? vistaUrl
      : 'por_vencer';
  const mesVencFiltro = parseInt(searchParams.get('mes_venc') ?? '', 10);
  const anioVencFiltro = parseInt(searchParams.get('anio_venc') ?? '', 10);
  const anioVencValido = validarAnioVencFiltro(
    Number.isFinite(anioVencFiltro) ? anioVencFiltro : undefined
  );
  const mesVencValido = validarMesVencFiltro(
    Number.isFinite(mesVencFiltro) ? mesVencFiltro : undefined,
    anioVencValido ?? null
  );

  const {
    paginaActual,
    setPaginaActual,
    tamPagina,
    onTamPaginaChange,
  } = usePaginacionServidor([
    searchParams.toString(),
    busquedaAplicada,
    sucursalFiltro,
    catMacroFiltro,
    categoriaFiltro,
    vistaSelect,
    mesVencValido,
    anioVencValido,
  ]);
  const aniosGenerados = useMemo(() => opcionesAnioVencimiento(3, 5), []);
  /**
   * Solo los años y meses con líneas (los meses, del año elegido). Mientras no haya respuesta
   * se ofrece el rango completo, para no dejar los filtros vacíos en la primera carga.
   */
  const aniosVencOpts = useMemo(
    () => (aniosConDatos.length > 0 ? aniosConDatos : aniosGenerados),
    [aniosConDatos, aniosGenerados]
  );
  const mesesVencOpts = useMemo(
    () =>
      mesesConDatos.length > 0
        ? MESES_CALENDARIO.filter((m) => mesesConDatos.includes(m.value))
        : MESES_CALENDARIO,
    [mesesConDatos]
  );

  const desdeHastaLabel = useMemo(
    () => etiquetaPeriodoParaRangeKey(rangeKey, vistaSelect === 'vencidos'),
    [rangeKey, vistaSelect]
  );


  const totalesConsolidado = totalesApi;

  const filtrosActivos = useMemo(() => {
    let n = 0;
    if (vistaSelect !== 'por_vencer') n += 1;
    if (rangeKey !== 'all') n += 1;
    if (sucursalFiltro) n += 1;
    if (catMacroFiltro) n += 1;
    if (categoriaFiltro) n += 1;
    if (mesVencValido) n += 1;
    if (anioVencValido) n += 1;
    return n;
  }, [
    vistaSelect,
    rangeKey,
    sucursalFiltro,
    catMacroFiltro,
    categoriaFiltro,
    mesVencValido,
    anioVencValido,
  ]);

  function nombreArchivoBase() {
    return `consolidado_por_vencer_${formatDateForFilename(fechaHoyArgentinaYmd())}`;
  }

  function valorCsv(value: unknown) {
    if (value == null) return '';
    const s = String(value);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  async function fetchTodosFiltrados(): Promise<ConsolidadoItem[]> {
    const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
    const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
    const params = new URLSearchParams();
    params.set('days', String(daysParam));
    params.set('daysMin', String(daysMinParam));
    if (sucursalFiltro) params.set('sucursal', sucursalFiltro);
    if (catMacroFiltro) params.set('cat_macro', catMacroFiltro);
    if (categoriaFiltro) params.set('categoria', categoriaFiltro);
    if (vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial') {
      params.set('vista', vistaUrl);
    }
    if (mesVencValido) params.set('mes_venc', String(mesVencValido));
    if (anioVencValido) params.set('anio_venc', String(anioVencValido));
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
    params.set('page', '1');
    params.set('pageSize', 'all');
    const res = await fetch(`/api/vencimientos/por-vencer/consolidado?${params.toString()}`);
    const json = (await res.json()) as { data?: ConsolidadoItem[] };
    return res.ok ? (json.data ?? []) : items;
  }

  async function exportarExcelFiltrado() {
    if (total === 0) return;
    const exportItems = await fetchTodosFiltrados();
    const headers = [
      'Sucursal',
      'Producto',
      'Presentacion',
      'Laboratorio',
      'Codigo barras',
      'Cat. padron',
      'Categoria',
      'Carga',
      'Vencimiento',
      'Dias',
      'Restante',
      'Vendido',
      'Monto',
      'Descuento',
    ];
    const rows = exportItems.map((r) => {
      const dias = diasHastaVencimiento(r.fecha_vencimiento);
      return [
        r.sucursal_nombre || `Sucursal ${r.sucursal_id}`,
        r.descripcion,
        r.presentacion ?? '',
        r.laboratorio ?? '',
        r.codigo_barras,
        r.cat_macro ?? '',
        r.categoria ?? '',
        formatDateTime(r.fecha_registro),
        formatDate(r.fecha_vencimiento),
        dias,
        Number(r.cantidad ?? 0).toFixed(0),
        Number(r.cantidad_vendida_acumulada ?? 0).toFixed(0),
        r.monto != null ? Number(r.monto).toFixed(2) : '',
        typeof r.descuento_aplicado === 'number' ? `-${Math.abs(r.descuento_aplicado)}%` : '',
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => valorCsv(cell)).join(';'))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombreArchivoBase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportarPdfFiltrado() {
    if (total === 0) return;
    const exportItems = await fetchTodosFiltrados();
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(11);
    doc.text('Consolidado por vencer (lineas filtradas)', 14, 12);
    autoTable(doc, {
      startY: 16,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235] },
      head: [[
        'Sucursal',
        'Producto',
        'Presentacion',
        'Cod. barras',
        'Venc.',
        'Rest.',
        'Vendido',
        'Monto',
        'Desc.',
      ]],
      body: exportItems.map((r) => [
        r.sucursal_nombre || `Sucursal ${r.sucursal_id}`,
        r.descripcion,
        r.presentacion ?? '',
        r.codigo_barras,
        formatDate(r.fecha_vencimiento),
        Number(r.cantidad ?? 0).toFixed(0),
        Number(r.cantidad_vendida_acumulada ?? 0).toFixed(0),
        r.monto != null ? formatMoneda(r.monto) : '—',
        typeof r.descuento_aplicado === 'number' ? `-${Math.abs(r.descuento_aplicado)}%` : '—',
      ]),
    });
    doc.save(`${nombreArchivoBase()}.pdf`);
  }

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      setRangeKey(
        detectarRangeKey(
          fechaHoyArgentinaYmd(),
          daysParam,
          daysMinParam,
          vistaSelect === 'vencidos'
        )
      );

      const params = new URLSearchParams();
      params.set('days', String(daysParam));
      params.set('daysMin', String(daysMinParam));
      if (sucursalFiltro) params.set('sucursal', sucursalFiltro);
      if (catMacroFiltro) params.set('cat_macro', catMacroFiltro);
      if (categoriaFiltro) params.set('categoria', categoriaFiltro);
      if (vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial') {
        params.set('vista', vistaUrl);
      }
      if (mesVencValido) params.set('mes_venc', String(mesVencValido));
      if (anioVencValido) params.set('anio_venc', String(anioVencValido));
      if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
      params.set('page', String(paginaActual));
      params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));

      const res = await fetch(`/api/vencimientos/por-vencer/consolidado?${params.toString()}`);
      const json = await res.json() as {
        data?: ConsolidadoItem[];
        total?: number;
        montoTotal?: number;
        cat_macros?: string[];
        categorias?: string[];
        anios_venc?: number[];
        meses_venc?: number[];
        sucursales?: Array<{ sucursal: number; nombrefantasia: string }>;
        totales?: typeof totalesApi;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar consolidado');
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(json.data ?? []);
      setTotal(json.total ?? 0);
      if (json.totales) {
        setTotalesApi({
          lineas: json.totales.lineas ?? 0,
          cajasRestantes: json.totales.cajasRestantes ?? 0,
          cajasVendidasHist: json.totales.cajasVendidasHist ?? 0,
          cajasMovimientoTotal: json.totales.cajasMovimientoTotal ?? 0,
          lineasLiquidados: json.totales.lineasLiquidados ?? 0,
          montoTotal: json.totales.montoTotal ?? json.montoTotal ?? 0,
        });
      } else {
        setTotalesApi((prev) => ({
          ...prev,
          montoTotal: json.montoTotal ?? 0,
        }));
      }
      setCatMacros(json.cat_macros ?? []);
      setCategorias(json.categorias ?? []);
      setAniosConDatos(json.anios_venc ?? []);
      setMesesConDatos(json.meses_venc ?? []);
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
        const perms = json?.data?.permissions as string[] | undefined;
        const rol = json?.data?.rol as string | undefined;
        if (!clientHasPermission(perms, rol, 'vencimientos.consolidado')) {
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
  }, [searchParams, autorizado, paginaActual, tamPagina, busquedaAplicada]);

  if (autorizado !== true) {
    return (
      <div className="py-12">
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className={DATATABLE_PAGE_ROOT}>
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

      <Card className={DATATABLE_CARD_CLASS}>
        <CardHeader className="shrink-0 py-3 print:hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:gap-5">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
              {!loading && !error && total > 0 ? (
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
                  <span>
                    Monto restante:{' '}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatMoneda(totalesConsolidado.montoTotal)}
                    </span>
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                    Mov. total aprox.: {totalesConsolidado.cajasMovimientoTotal.toFixed(0)} ·
                    Liquidados: {totalesConsolidado.lineasLiquidados}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={filtrosAbiertos ? 'secondary' : 'outline'}
                onClick={() => setFiltrosAbiertos((v) => !v)}
              >
                <Filter className="mr-1 h-4 w-4" />
                Filtros
                {filtrosActivos > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
                    {filtrosActivos}
                  </span>
                ) : null}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportarExcelFiltrado}
                disabled={loading || total === 0}
              >
                Exportar CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportarPdfFiltrado}
                disabled={loading || total === 0}
              >
                Exportar PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <PorVencerConsolidadoFiltrosPanel
              abierto={filtrosAbiertos}
              onCerrar={() => setFiltrosAbiertos(false)}
              vistaSelect={vistaSelect}
              rangeKey={rangeKey}
              onRangeKeyChange={setRangeKey}
              sucursalFiltro={sucursalFiltro}
              catMacroFiltro={catMacroFiltro}
              categoriaFiltro={categoriaFiltro}
              mesVencValido={mesVencValido}
              anioVencValido={anioVencValido}
              mesesVencOpts={mesesVencOpts}
              aniosVencOpts={aniosVencOpts}
              sucursales={sucursales}
              catMacrosDisponibles={catMacros}
              categoriasDisponibles={categorias}
              loading={loading}
              onActualizar={() => void cargar()}
            />
          <DatatableListSection
            busquedaTexto={busquedaAplicada}
            onBusquedaChange={(v) => setBusquedaAplicada(v.trim())}
            tamPagina={tamPagina}
            onTamPaginaChange={onTamPaginaChange}
            paginaActual={paginaActual}
            onPaginaChange={setPaginaActual}
            totalFilas={total}
            searchPlaceholder="Buscar producto, código, sucursal…"
            footerDetalle={`${total} línea${total !== 1 ? 's' : ''}`}
            loading={loading}
            error={error || null}
            empty={!loading && !error && total === 0}
            emptyMessage={
              <>
                {vistaSelect === 'vendidos' && 'No hay liquidados en ese rango.'}
                {vistaSelect === 'vendido_parcial' &&
                  'No hay líneas con venta parcial sin liquidar en ese rango.'}
                {vistaSelect === 'vencidos' && 'No hay vencidos sin liquidar en ese rango.'}
                {vistaSelect === 'por_vencer' && 'No hay registros con esos filtros.'}
              </>
            }
            mobile={<ConsolidadoListMobile items={items} />}
            table={
              <table className="w-full min-w-[1000px] text-sm">
                <thead className={DATATABLE_STICKY_THEAD}>
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
                      Monto
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-300">
                      Desc.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((r) => {
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
                        <td
                          className="px-4 py-2 align-top text-right text-xs tabular-nums text-gray-800 dark:text-gray-200"
                          title={r.precio != null ? `PVP: ${formatMoneda(r.precio)}` : 'PVP no disponible'}
                        >
                          {r.monto != null ? formatMoneda(r.monto) : '—'}
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
            }
          />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
