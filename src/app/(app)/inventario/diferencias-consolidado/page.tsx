'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ArrowLeft } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { clientHasPermission } from '@/lib/auth/permissions-client';
import { VencimientosTablaContenedor } from '@/components/vencimientos/VencimientosTablaContenedor';
import { TablaImpresionDiferenciasConsolidado } from '@/components/vencimientos/TablaImpresionDiferenciasConsolidado';
import {
  BotonImprimirListadoVencimientos,
  EncabezadoImpresionListadoVencimientos,
  VENCIMIENTOS_PRINT_AREA_ATTR,
} from '@/components/vencimientos/ImprimirListadoVencimientos';
import {
  mesesCalendarioSeleccionables,
  opcionesAnioHastaActual,
  sanitizarAnioFiltro,
  sanitizarMesFiltro,
} from '@/lib/vencimientos-mes-anio-filtro';
import {
  ORIGENES_DIFERENCIA_FILTRO,
  TIPOS_INVENTARIO_FILTRO,
} from '@/lib/inventario/diferencias-consolidado-tipos';
import { etiquetaTipoControlInventario } from '@/lib/inventario/tipo-control';
import type { TipoControlInventario } from '@/lib/inventario/tipo-control';
import DiferenciasConsolidadoListMobile from '@/components/inventario/DiferenciasConsolidadoListMobile';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_STICKY_THEAD,
  DATATABLE_TD,
  DATATABLE_TH,
  DATATABLE_PAGE_ROOT,
} from '@/components/list/datatable-classes';
import { DatatableListSection } from '@/components/list/DatatableListSection';
import {
  usePaginacionServidor,
  useTotalPaginas,
} from '@/components/list/datatable-pagination';
import { tamPaginaToPageSizeParam } from '@/lib/api/pagination';

interface FilaDif {
  detalle_id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  diffCajas: number;
  diffUnidades: number;
  operador: string;
  fecha_control: string;
  control_tipo: string | null;
  control_descripcion: string | null;
  control_origen: string | null;
  cat_macro: string | null;
  sucursal_id?: number;
  sucursal_nombre?: string | null;
}

function etiquetaOrigen(o: string | null | undefined): string {
  const t = String(o ?? '').trim();
  if (t === 'Auditoria') return 'Auditoría';
  if (t === 'Sucursal') return 'Sucursal';
  return t || '—';
}

export default function DiferenciasConsolidadoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<FilaDif[]>([]);
  const [itemsImpresion, setItemsImpresion] = useState<FilaDif[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sucursales, setSucursales] = useState<Array<{ sucursal: number; nombrefantasia: string }>>([]);
  const [catMacros, setCatMacros] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [rangeKey, setRangeKey] = useState<
    'all' | '30_all' | '60_all' | '90_all' | '30_only' | '60_only' | '90_only'
  >('90_all');

  const sucursalFiltro = searchParams.get('sucursal') ?? '';
  const origenFiltro = searchParams.get('origen') ?? '';
  const tipoFiltro = searchParams.get('tipo') ?? '';
  const catMacroFiltro = searchParams.get('cat_macro') ?? '';
  const anioFiltroNum = sanitizarAnioFiltro(
    parseInt(searchParams.get('anio') ?? '', 10) || undefined
  );
  const mesFiltroNum = sanitizarMesFiltro(
    parseInt(searchParams.get('mes') ?? '', 10) || undefined,
    anioFiltroNum ?? null
  );
  const mesFiltro = mesFiltroNum != null ? String(mesFiltroNum) : '';
  const anioFiltro = anioFiltroNum != null ? String(anioFiltroNum) : '';
  const mesesOpts = useMemo(
    () => mesesCalendarioSeleccionables(anioFiltroNum ?? null),
    [anioFiltroNum]
  );
  const aniosOpts = useMemo(() => opcionesAnioHastaActual(5), []);

  const {
    paginaActual,
    setPaginaActual,
    tamPagina,
    onTamPaginaChange,
  } = usePaginacionServidor([
    searchParams.toString(),
    busquedaAplicada,
  ]);

  const totalPaginas = useTotalPaginas(total, tamPagina);

  function buildParams(overrides: Record<string, string>) {
    const p = new URLSearchParams(searchParams.toString());
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
      const daysParam = parseInt(searchParams.get('days') ?? '90', 10) || 90;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      if (daysParam === 365 && daysMinParam === 0) setRangeKey('all');
      else if (daysParam === 30 && daysMinParam === 0) setRangeKey('30_all');
      else if (daysParam === 60 && daysMinParam === 0) setRangeKey('60_all');
      else if (daysParam === 90 && daysMinParam === 0) setRangeKey('90_all');
      else setRangeKey('90_all');

      const params = new URLSearchParams();
      params.set('days', String(daysParam));
      params.set('daysMin', String(daysMinParam));
      if (sucursalFiltro) params.set('sucursal', sucursalFiltro);
      if (origenFiltro) params.set('origen', origenFiltro);
      if (tipoFiltro) params.set('tipo', tipoFiltro);
      if (catMacroFiltro) params.set('categoria_macro', catMacroFiltro);
      if (mesFiltro) params.set('mes', mesFiltro);
      if (anioFiltro) params.set('anio', anioFiltro);
      if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
      params.set('page', String(paginaActual));
      params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));

      const res = await fetch(`/api/inventario/diferencias-consolidado?${params.toString()}`);
      const json = (await res.json()) as {
        data?: FilaDif[];
        total?: number;
        sucursales?: Array<{ sucursal: number; nombrefantasia: string }>;
        cat_macros?: string[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar');
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(json.data ?? []);
      setTotal(json.total ?? 0);
      setSucursales(json.sucursales ?? []);
      setCatMacros(json.cat_macros ?? []);
    } catch {
      setError('Error al cargar consolidado');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const prepararImpresion = useCallback(async () => {
    if (tamPagina === 'all' && items.length >= total && total > 0) {
      setItemsImpresion(null);
      return;
    }
    const daysParam = parseInt(searchParams.get('days') ?? '90', 10) || 90;
    const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
    const params = new URLSearchParams();
    params.set('days', String(daysParam));
    params.set('daysMin', String(daysMinParam));
    if (sucursalFiltro) params.set('sucursal', sucursalFiltro);
    if (origenFiltro) params.set('origen', origenFiltro);
    if (tipoFiltro) params.set('tipo', tipoFiltro);
    if (catMacroFiltro) params.set('categoria_macro', catMacroFiltro);
    if (mesFiltro) params.set('mes', mesFiltro);
    if (anioFiltro) params.set('anio', anioFiltro);
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
    params.set('page', '1');
    params.set('pageSize', 'all');
    const res = await fetch(`/api/inventario/diferencias-consolidado?${params.toString()}`);
    const json = (await res.json()) as { data?: FilaDif[]; error?: string };
    if (!res.ok) throw new Error(json.error ?? 'Error al preparar impresión');
    setItemsImpresion(json.data ?? []);
  }, [
    tamPagina,
    items.length,
    total,
    searchParams,
    sucursalFiltro,
    origenFiltro,
    tipoFiltro,
    catMacroFiltro,
    mesFiltro,
    anioFiltro,
    busquedaAplicada,
  ]);

  useEffect(() => {
    setItemsImpresion(null);
  }, [searchParams, paginaActual, tamPagina, busquedaAplicada]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        const perms = json?.data?.permissions as string[] | undefined;
        const rol = json?.data?.rol as string | undefined;
        if (!clientHasPermission(perms, rol, 'inventario.diferencias_consolidado')) {
          router.replace('/inventario/diferencias-resumen');
          return;
        }
        setAutorizado(true);
      } catch {
        router.replace('/inventario/diferencias-resumen');
      }
    })();
  }, [router]);

  useEffect(() => {
    if (autorizado !== true) return;
    const days = searchParams.get('days');
    const daysMin = searchParams.get('daysMin');
    if (!days || !daysMin) {
      const p = new URLSearchParams(searchParams.toString());
      if (!days) p.set('days', '90');
      if (!daysMin) p.set('daysMin', '0');
      router.replace(`/inventario/diferencias-consolidado?${p.toString()}`);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div className="flex min-w-0 items-start gap-2">
          <Link
            href="/inventario/diferencias-resumen"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-bold leading-tight text-gray-900 sm:text-xl dark:text-gray-100">
            Diferencias — consolidado
          </h1>
        </div>
        <Link href="/inventario" className="shrink-0 self-start sm:self-center">
          <Button size="sm" variant="outline" className="w-full sm:w-auto">
            Inventarios
          </Button>
        </Link>
      </div>

      <Card className="print:hidden">
        <CardHeader className="space-y-3">
          <div>
            <p className="text-sm font-medium">Filtros</p>
            <p className="text-xs text-gray-500">
              Todas las sucursales · Por fecha de cierre del control · Origen y tipo de inventario.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Periodo</label>
                <select
                  value={rangeKey}
                  onChange={(e) => {
                    const next = e.target.value as typeof rangeKey;
                    let d = 90;
                    let dm = 0;
                    if (next === 'all') {
                      d = 365;
                      dm = 0;
                    } else if (next === '30_all') {
                      d = 30;
                    } else if (next === '60_all') {
                      d = 60;
                    } else if (next === '90_all') {
                      d = 90;
                    }
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ days: String(d), daysMin: String(dm) }).toString()}`
                    );
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Todo el año</option>
                  <option value="30_all">30 días</option>
                  <option value="60_all">60 días</option>
                  <option value="90_all">90 días</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Sucursal</label>
                <select
                  value={sucursalFiltro}
                  onChange={(e) =>
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ sucursal: e.target.value }).toString()}`
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Todas</option>
                  {sucursales.map((s) => (
                    <option key={s.sucursal} value={String(s.sucursal)}>
                      {s.nombrefantasia}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Origen</label>
                <select
                  value={origenFiltro}
                  onChange={(e) =>
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ origen: e.target.value }).toString()}`
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {ORIGENES_DIFERENCIA_FILTRO.map((o) => (
                    <option key={o.value || 'all'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Tipo inventario</label>
                <select
                  value={tipoFiltro}
                  onChange={(e) =>
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ tipo: e.target.value }).toString()}`
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TIPOS_INVENTARIO_FILTRO.map((t) => (
                    <option key={t.value || 'all'} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Cat. macro</label>
                <select
                  value={catMacroFiltro}
                  onChange={(e) =>
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ cat_macro: e.target.value }).toString()}`
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                <label className="text-xs font-medium">Mes control</label>
                <select
                  value={mesFiltro}
                  onChange={(e) =>
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams({ mes: e.target.value }).toString()}`
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Todos</option>
                  {mesesOpts.map((m) => (
                    <option key={m.value} value={String(m.value)}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Año control</label>
                <select
                  value={anioFiltro}
                  onChange={(e) => {
                    const v = e.target.value;
                    const overrides: Record<string, string> = { anio: v };
                    if (mesFiltroNum != null) {
                      const nuevoAnio = v ? parseInt(v, 10) : null;
                      if (sanitizarMesFiltro(mesFiltroNum, nuevoAnio) == null) {
                        overrides.mes = '';
                      }
                    }
                    router.push(
                      `/inventario/diferencias-consolidado?${buildParams(overrides).toString()}`
                    );
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Todos</option>
                  {aniosOpts.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={loading}
                className="w-full sm:col-span-2 lg:w-auto"
                onClick={() => void cargar()}
              >
                Actualizar
              </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className={DATATABLE_CARD_CLASS} {...{ [VENCIMIENTOS_PRINT_AREA_ATTR]: '' }}>
        <CardHeader className="shrink-0 py-3 print:hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Listado ({total})</h2>
            <BotonImprimirListadoVencimientos
              disabled={loading || total === 0}
              onPreparePrint={prepararImpresion}
            />
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <EncabezadoImpresionListadoVencimientos
            titulo="Diferencias de inventario — consolidado"
            detalle={`Origen: ${origenFiltro || 'todos'} · Tipo: ${tipoFiltro || 'todos'}`}
            cantidadRegistros={total}
          />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <DatatableListSection
            busquedaTexto={busquedaAplicada}
            onBusquedaChange={(v) => setBusquedaAplicada(v.trim())}
            tamPagina={tamPagina}
            onTamPaginaChange={onTamPaginaChange}
            paginaActual={paginaActual}
            onPaginaChange={setPaginaActual}
            totalFilas={total}
            searchPlaceholder="Buscar producto, sucursal…"
            footerDetalle={`${total} diferencia${total !== 1 ? 's' : ''}`}
            loading={loading}
            error={error || null}
            empty={!loading && !error && total === 0}
            emptyMessage="Sin diferencias para los filtros seleccionados."
            printOnly={<TablaImpresionDiferenciasConsolidado items={itemsImpresion ?? items} />}
            mobile={<DiferenciasConsolidadoListMobile items={items} />}
            table={
              <table className="w-full min-w-[980px] text-sm print:min-w-0 print:text-[8px]">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    <th className={DATATABLE_TH}>Sucursal</th>
                    <th className={DATATABLE_TH}>Producto</th>
                    <th className={DATATABLE_TH}>Origen</th>
                    <th className={DATATABLE_TH}>Tipo</th>
                    <th className={`${DATATABLE_TH} text-right`}>Dif. cajas / uds.</th>
                    <th className={DATATABLE_TH}>Fecha</th>
                    <th className={DATATABLE_TH}>Operador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((r) => (
                    <tr key={`${r.detalle_id}-${r.control_id}`}>
                      <td className={DATATABLE_TD}>{r.sucursal_nombre ?? '—'}</td>
                      <td className={DATATABLE_TD}>
                        <p className="font-medium">{r.descripcion}</p>
                        <p className="text-xs text-gray-500">
                          {r.presentacion} · {r.codigo_barras}
                        </p>
                        {r.cat_macro ? (
                          <p className="text-[10px] text-gray-400">{r.cat_macro}</p>
                        ) : null}
                      </td>
                      <td className={`${DATATABLE_TD} text-xs`}>{etiquetaOrigen(r.control_origen)}</td>
                      <td className={`${DATATABLE_TD} text-xs`}>
                        {r.control_tipo
                          ? etiquetaTipoControlInventario(r.control_tipo as TipoControlInventario)
                          : '—'}
                      </td>
                      <td className={`${DATATABLE_TD} text-right tabular-nums text-xs`}>
                        {r.diffCajas > 0 ? '+' : ''}
                        {r.diffCajas} / {r.diffUnidades > 0 ? '+' : ''}
                        {r.diffUnidades}
                      </td>
                      <td className={`${DATATABLE_TD} whitespace-nowrap text-xs`}>
                        {r.fecha_control ? formatDateTime(r.fecha_control) : '—'}
                      </td>
                      <td className={`${DATATABLE_TD} text-xs`}>{r.operador}</td>
                    </tr>
                  ))}
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
