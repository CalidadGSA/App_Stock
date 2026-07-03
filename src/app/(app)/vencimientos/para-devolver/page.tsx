'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import {
  formatDate,
  diasHastaVencimiento,
  colorVencimiento,
  etiquetaDiasHastaVencimiento,
} from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import VencidosListMobile from '@/components/vencimientos/VencidosListMobile';
import {
  etiquetaDrogueriaDevolucion,
  textoBadgeDrogueriaDevolucion,
} from '@/lib/vencimientos-drogueria-lab';
import {
  BotonImprimirListadoVencimientos,
  EncabezadoImpresionListadoVencimientos,
  VENCIMIENTOS_PRINT_AREA_ATTR,
} from '@/components/vencimientos/ImprimirListadoVencimientos';
import { VencimientosTablaContenedor } from '@/components/vencimientos/VencimientosTablaContenedor';
import { TablaImpresionVencimientosCompacta } from '@/components/vencimientos/TablaImpresionVencimientosCompacta';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_FILTER_LABEL,
  DATATABLE_FILTER_SELECT,
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
import {
  obligatorioObservacionDevolucion,
  ratioVendidoSobreOriginal,
  tieneObservacionDevolucion,
} from '@/lib/vencimientos/observacion-devolucion';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

interface VencidoItem {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro: string | null;
  cantidad: number;
  categoria_macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  accion_observacion: string | null;
  cantidad_vendida_acumulada: number;
  cantidad_cargada_original: number;
  ratio_vendido_sobre_original: number | null;
  obligatorio_observacion_devolucion: boolean;
  venta_posterior_a_carga?: boolean;
  drogueria_devolucion?: string | null;
}

function textoObservacionEfectiva(
  item: { id: string; accion_observacion?: string | null },
  obsLocal: Record<string, string>
): string {
  if (obsLocal[item.id] !== undefined) return obsLocal[item.id];
  return item.accion_observacion ?? '';
}

function itemRequiereObservacionDevolucion(item: {
  cantidad_cargada_original: number;
  cantidad_vendida_acumulada: number;
}): boolean {
  return obligatorioObservacionDevolucion(
    item.cantidad_cargada_original,
    item.cantidad_vendida_acumulada
  );
}

function calcularIdsSinObservacionDevolucion(
  idsDesdeApi: string[],
  itemsPagina: VencidoItem[],
  obsLocal: Record<string, string>
): Set<string> {
  const pending = new Set(idsDesdeApi);
  for (const item of itemsPagina) {
    if (!itemRequiereObservacionDevolucion(item)) continue;
    const eff = textoObservacionEfectiva(item, obsLocal);
    if (tieneObservacionDevolucion(eff)) pending.delete(item.id);
    else pending.add(item.id);
  }
  for (const [id, text] of Object.entries(obsLocal)) {
    if (text.trim()) pending.delete(id);
  }
  return pending;
}

export default function VencidosPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const [items, setItems] = useState<VencidoItem[]>([]);
  const [itemsImpresion, setItemsImpresion] = useState<VencidoItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [loading, setLoading] = useState(true);
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('');
  const [drogueriaFiltro, setDrogueriaFiltro] = useState('');
  const [droguerias, setDroguerias] = useState<string[]>([]);
  const [obsLocal, setObsLocal] = useState<Record<string, string>>({});
  const [sinObservacionDevolucionIds, setSinObservacionDevolucionIds] = useState<string[]>([]);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<
    'producto' | 'macro' | 'vencimiento' | 'cantidad' | 'restante' | 'vendido'
  >('vencimiento');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [ventaPosteriorCheckStatus, setVentaPosteriorCheckStatus] = useState<
    'off' | 'full' | 'skipped_slow_db' | 'skipped_unavailable'
  >('off');
  const ventaPosteriorCacheRef = useRef<Map<string, boolean>>(new Map());
  const ventaPosteriorCheckHechoRef = useRef(false);
  const prevFiltrosKeyRef = useRef('');

  const filtrosKey = [drogueriaFiltro, categoriaFiltro, busquedaAplicada, sortKey, sortDir].join('|');

  const {
    paginaActual,
    setPaginaActual,
    tamPagina,
    onTamPaginaChange,
  } = usePaginacionServidor([
    drogueriaFiltro,
    categoriaFiltro,
    busquedaAplicada,
    sortKey,
    sortDir,
  ]);

  const totalPaginas = useTotalPaginas(total, tamPagina);
  const itemsPaginados = items;

  const idsSinObservacion = useMemo(
    () => calcularIdsSinObservacionDevolucion(sinObservacionDevolucionIds, items, obsLocal),
    [sinObservacionDevolucionIds, items, obsLocal]
  );

  const puedeDevolverTodos = total > 0 && !loading && idsSinObservacion.size === 0;
  const tooltipDevolverTodos =
    idsSinObservacion.size > 0
      ? `Completá la observación en ${idsSinObservacion.size} producto(s) con menos del 50 % vendido`
      : undefined;

  function toggleSort(key: 'producto' | 'macro' | 'vencimiento' | 'cantidad' | 'restante' | 'vendido') {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'vencimiento' || key === 'producto' || key === 'macro' ? 'asc' : 'desc');
  }

  async function cargar(opciones?: { forzarCheckVentaPosterior?: boolean; limpiarObsLocal?: boolean }) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const solicitarCheck =
        opciones?.forzarCheckVentaPosterior || !ventaPosteriorCheckHechoRef.current;
      if (solicitarCheck) {
        params.set('check_venta_posterior', '1');
      } else {
        params.set('check_venta_posterior', '0');
      }
      if (drogueriaFiltro) params.set('drogueria', drogueriaFiltro);
      if (categoriaFiltro) params.set('categoria_macro', categoriaFiltro);
      if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
      params.set('sortBy', sortKey);
      params.set('sortDir', sortDir);
      params.set('page', String(paginaActual));
      params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));
      const res = await fetch(`/api/vencimientos/para-devolver?${params.toString()}`);
      const json = await res.json() as {
        data?: VencidoItem[];
        total?: number;
        droguerias?: string[];
        sin_observacion_devolucion_ids?: string[];
        error?: string;
        venta_posterior_check?: 'off' | 'full' | 'skipped_slow_db' | 'skipped_unavailable';
      };
      if (!res.ok) {
        notify.error(json.error ?? 'Error al cargar productos para devolver');
        setItems([]);
        setTotal(0);
        setSinObservacionDevolucionIds([]);
        return;
      }
      const rawList = json.data ?? [];
      let nextList = rawList;
      if (solicitarCheck) {
        for (const i of rawList) {
          ventaPosteriorCacheRef.current.set(i.id, !!i.venta_posterior_a_carga);
        }
        ventaPosteriorCheckHechoRef.current = true;
      } else {
        nextList = rawList.map((i) => ({
          ...i,
          venta_posterior_a_carga: ventaPosteriorCacheRef.current.get(i.id) ?? false,
        }));
      }
      setItems(nextList);
      setTotal(json.total ?? 0);
      setDroguerias(json.droguerias ?? []);
      setSinObservacionDevolucionIds(json.sin_observacion_devolucion_ids ?? []);
      if (opciones?.limpiarObsLocal) {
        setObsLocal({});
      }
      if (json.venta_posterior_check) {
        setVentaPosteriorCheckStatus(json.venta_posterior_check);
      }
    } catch {
      notify.error('Error al cargar productos para devolver');
      setItems([]);
      setSinObservacionDevolucionIds([]);
    } finally {
      setLoading(false);
    }
  }

  const prepararImpresion = useCallback(async () => {
    if (tamPagina === 'all' && items.length >= total && total > 0) {
      setItemsImpresion(null);
      return;
    }
    const params = new URLSearchParams();
    params.set('check_venta_posterior', '0');
    if (drogueriaFiltro) params.set('drogueria', drogueriaFiltro);
    if (categoriaFiltro) params.set('categoria_macro', categoriaFiltro);
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
    params.set('sortBy', sortKey);
    params.set('sortDir', sortDir);
    params.set('page', '1');
    params.set('pageSize', 'all');
    const res = await fetch(`/api/vencimientos/para-devolver?${params.toString()}`);
    const json = (await res.json()) as { data?: VencidoItem[]; error?: string };
    if (!res.ok) throw new Error(json.error ?? 'Error al preparar impresión');
    const rawList = json.data ?? [];
    setItemsImpresion(
      rawList.map((i) => ({
        ...i,
        venta_posterior_a_carga: ventaPosteriorCacheRef.current.get(i.id) ?? false,
      }))
    );
  }, [
    tamPagina,
    items.length,
    total,
    drogueriaFiltro,
    categoriaFiltro,
    busquedaAplicada,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    setItemsImpresion(null);
  }, [filtrosKey, paginaActual, tamPagina]);

  useEffect(() => {
    const limpiarObsLocal = prevFiltrosKeyRef.current !== filtrosKey;
    prevFiltrosKeyRef.current = filtrosKey;
    void cargar({ limpiarObsLocal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey, paginaActual, tamPagina]);

  const guardarObservacion = useCallback(async (item: { id: string; accion_observacion?: string | null }) => {
    const texto = textoObservacionEfectiva(item, obsLocal).trim();
    setGuardandoId(item.id);
    try {
      const res = await fetch('/api/vencimientos/para-devolver', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, accion_observacion: texto }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        accion_observacion?: string | null;
      };
      if (!res.ok) {
        notify.error(json.error ?? 'Error al guardar la observación');
        return;
      }
      const guardado = json.accion_observacion ?? null;
      setItems((prev) =>
        prev.map((x) => {
          if (x.id !== item.id) return x;
          const orig = x.cantidad_cargada_original;
          const vend = x.cantidad_vendida_acumulada;
          const ratio = ratioVendidoSobreOriginal(x.cantidad, vend);
          return {
            ...x,
            accion_observacion: guardado,
            ratio_vendido_sobre_original: ratio,
            obligatorio_observacion_devolucion: itemRequiereObservacionDevolucion(x),
          };
        })
      );
      setSinObservacionDevolucionIds((prev) => {
        const row = items.find((x) => x.id === item.id);
        if (!row || !itemRequiereObservacionDevolucion(row)) return prev;
        if (tieneObservacionDevolucion(guardado)) return prev.filter((id) => id !== item.id);
        if (!prev.includes(item.id)) return [...prev, item.id];
        return prev;
      });
      setObsLocal((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      notify.success('Observación guardada');
    } catch {
      notify.error('Error al guardar la observación');
    } finally {
      setGuardandoId(null);
    }
  }, [items, notify, obsLocal]);

  async function marcarVendido(id: string, cantidadDisponible: number) {
    const max = Math.max(0, Math.floor(Number(cantidadDisponible) || 0));
    if (max <= 0) {
      notify.warning('El registro no tiene cantidad disponible para marcar como vendido.');
      return;
    }
    const ingresado = window.prompt(`¿Cuántas unidades se vendieron? (1 a ${max})`, '1');
    if (ingresado == null) return;
    const cantidad = parseInt(ingresado, 10);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > max) {
      notify.warning(`Ingresá una cantidad válida entre 1 y ${max}.`);
      return;
    }
    try {
      const params = new URLSearchParams({
        id,
        cantidad: String(cantidad),
      });
      const res = await fetch(`/api/vencimientos/para-devolver?${params.toString()}`, {
        method: 'PATCH',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; cantidad_restante?: number };
      if (!res.ok) {
        notify.error(json.error ?? 'Error al marcar como vendido');
        return;
      }
      const restante = Number(json.cantidad_restante ?? 0);
      setItems((prev) =>
        prev
          .map((x) => {
            if (x.id !== id) return x;
            const newVend = (x.cantidad_vendida_acumulada ?? 0) + cantidad;
            const orig = x.cantidad_cargada_original;
            const ratio = ratioVendidoSobreOriginal(restante, newVend);
            const next = {
              ...x,
              cantidad: restante,
              cantidad_vendida_acumulada: newVend,
              ratio_vendido_sobre_original: ratio,
              obligatorio_observacion_devolucion: obligatorioObservacionDevolucion(orig, newVend),
            };
            return next;
          })
          .filter((x) => x.cantidad > 0)
      );
      setSinObservacionDevolucionIds((prev) => {
        const row = items.find((x) => x.id === id);
        if (!row) return prev.filter((itemId) => itemId !== id);
        const newVend = (row.cantidad_vendida_acumulada ?? 0) + cantidad;
        const obligatorio = obligatorioObservacionDevolucion(row.cantidad_cargada_original, newVend);
        const obs = textoObservacionEfectiva(row, obsLocal);
        if (!obligatorio || tieneObservacionDevolucion(obs)) {
          return prev.filter((itemId) => itemId !== id);
        }
        if (!prev.includes(id)) return [...prev, id];
        return prev;
      });
      notify.success('Venta registrada');
    } catch {
      notify.error('Error al marcar como vendido');
    }
  }

  async function fetchTodosFiltrados(): Promise<VencidoItem[]> {
    const params = new URLSearchParams();
    params.set('check_venta_posterior', '0');
    if (drogueriaFiltro) params.set('drogueria', drogueriaFiltro);
    if (categoriaFiltro) params.set('categoria_macro', categoriaFiltro);
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
    params.set('sortBy', sortKey);
    params.set('sortDir', sortDir);
    params.set('page', '1');
    params.set('pageSize', 'all');
    const res = await fetch(`/api/vencimientos/para-devolver?${params.toString()}`);
    const json = (await res.json()) as { data?: VencidoItem[] };
    return res.ok ? (json.data ?? []) : items;
  }

  async function devolverTodos() {
    if (!puedeDevolverTodos) return;

    const todos = await fetchTodosFiltrados();
    const sinObsPrevio = todos.filter(
      (i) =>
        itemRequiereObservacionDevolucion(i) &&
        !tieneObservacionDevolucion(textoObservacionEfectiva(i, obsLocal))
    );
    if (sinObsPrevio.length > 0) {
      notify.warning(
        `Hay ${sinObsPrevio.length} producto(s) con menos del 50 % vendido que requieren observación antes de devolver.`
      );
      return;
    }

    if (!(await notify.confirm({
      title: 'Devolver productos',
      message: '¿Marcar como devueltos todos los productos listados?',
      confirmLabel: 'Devolver todos',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    }))) return;
    try {
      for (const i of todos) {
        if (obsLocal[i.id] === undefined) continue;
        const texto = obsLocal[i.id].trim();
        const server = (i.accion_observacion ?? '').trim();
        if (texto === server) continue;
        const resObs = await fetch('/api/vencimientos/para-devolver', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: i.id, accion_observacion: texto }),
        });
        const jObs = (await resObs.json().catch(() => ({}))) as { error?: string };
        if (!resObs.ok) {
          notify.error(jObs.error ?? 'Error al guardar observaciones antes de devolver');
          return;
        }
      }

      const ids = todos.map((i) => i.id);
      const res = await fetch('/api/vencimientos/para-devolver?devolver_todos=1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        productos_sin_observacion?: string[];
      };
      if (!res.ok) {
        const extra =
          Array.isArray(json.productos_sin_observacion) && json.productos_sin_observacion.length > 0
            ? ` ${json.productos_sin_observacion.slice(0, 5).join('; ')}${json.productos_sin_observacion.length > 5 ? '…' : ''}`
            : '';
        notify.error((json.error ?? 'Error al devolver los productos') + extra);
        return;
      }
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((x) => !idSet.has(x.id)));
      setTotal((prev) => Math.max(0, prev - ids.length));
      setSinObservacionDevolucionIds([]);
      setObsLocal((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      notify.success(`${ids.length} producto(s) marcados como devueltos`);
    } catch {
      notify.error('Error al devolver los productos');
    }
  }


  return (
    <div className={DATATABLE_PAGE_ROOT}>
      <div className="flex shrink-0 items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Volver"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Productos para devolver</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vencimientos/devoluciones">
            <Button size="sm" variant="outline">
              Historial de devoluciones
            </Button>
          </Link>
          <Link href="/vencimientos">
            <Button size="sm" variant="outline">
              Ver controles
            </Button>
          </Link>
        </div>
      </div>

      {(ventaPosteriorCheckStatus === 'skipped_slow_db' ||
        ventaPosteriorCheckStatus === 'skipped_unavailable') && (
        <div className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 print:hidden">
          {ventaPosteriorCheckStatus === 'skipped_slow_db'
            ? 'La base onze_center respondió lento. Se omitió la verificación de ventas posteriores para cargar el listado más rápido.'
            : 'No se pudo consultar onze_center a tiempo. Se omitió la verificación de ventas posteriores.'}{' '}
          Usá «Actualizar» para reintentar.
        </div>
      )}

      <Card className={DATATABLE_CARD_CLASS} {...{ [VENCIMIENTOS_PRINT_AREA_ATTR]: '' }}>
        <CardHeader className="shrink-0 py-3 print:hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
            </div>
            <BotonImprimirListadoVencimientos
              disabled={loading || total === 0}
              className="shrink-0"
              onPreparePrint={prepararImpresion}
            />
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <EncabezadoImpresionListadoVencimientos
            titulo="Productos para devolver"
            detalle="BIENESTAR: &lt;10 días para vencer · FARMA/PSICO: mes anterior al vencimiento (&lt;40 días en ese mes)"
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
            searchPlaceholder="Buscar producto, código, laboratorio…"
            footerDetalle={`${total} producto${total !== 1 ? 's' : ''}`}
            loading={loading}
            error={null}
            empty={!loading && total === 0}
            emptyMessage="No hay productos para devolver."
            toolbarFilters={
              <>
                <label className="flex flex-col gap-0.5">
                  <span className={DATATABLE_FILTER_LABEL}>Categoría macro</span>
                  <select
                    value={categoriaFiltro}
                    onChange={(e) => setCategoriaFiltro(e.target.value)}
                    className={DATATABLE_FILTER_SELECT}
                  >
                    <option value="">Todas</option>
                    <option value="FARMA">FARMA</option>
                    <option value="BIENESTAR">BIENESTAR</option>
                    <option value="PSICOTROPICOS">PSICOTROPICOS</option>
                  </select>
                </label>
                {droguerias.length > 0 ? (
                  <label className="flex flex-col gap-0.5">
                    <span className={DATATABLE_FILTER_LABEL}>Separar por bulto</span>
                    <select
                      value={drogueriaFiltro}
                      onChange={(e) => setDrogueriaFiltro(e.target.value)}
                      className={`${DATATABLE_FILTER_SELECT} min-w-[10rem] sm:min-w-[11rem]`}
                    >
                      <option value="">Todos los bultos</option>
                      {droguerias.map((d) => (
                        <option key={d} value={d}>
                          {etiquetaDrogueriaDevolucion(d) ?? d}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 sm:h-8"
                  disabled={loading}
                  onClick={() => {
                    ventaPosteriorCheckHechoRef.current = false;
                    ventaPosteriorCacheRef.current.clear();
                    void cargar({ forzarCheckVentaPosterior: true });
                  }}
                >
                  Actualizar
                </Button>
              </>
            }
            footerActions={
              total > 0 ? (
                <>
                  {!puedeDevolverTodos && idsSinObservacion.size > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Faltan observaciones obligatorias en {idsSinObservacion.size} producto
                      {idsSinObservacion.size !== 1 ? 's' : ''} del listado filtrado.
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void devolverTodos()}
                    disabled={loading || !puedeDevolverTodos}
                    title={tooltipDevolverTodos}
                  >
                    Devolver todos
                  </Button>
                </>
              ) : null
            }
            printOnly={<TablaImpresionVencimientosCompacta items={itemsImpresion ?? items} />}
            mobile={
              <VencidosListMobile
                items={itemsPaginados}
                textoObs={(item) => textoObservacionEfectiva(item, obsLocal)}
                onObsChange={(id, value) =>
                  setObsLocal((prev) => ({ ...prev, [id]: value }))
                }
                guardandoId={guardandoId}
                onGuardarObs={(item) => void guardarObservacion(item)}
                onVendido={(id, cant) => void marcarVendido(id, cant)}
                alertaObs={(item) => itemRequiereObservacionDevolucion(item)}
              />
            }
            table={
              <table className="w-full min-w-[960px] text-sm print:min-w-0 print:text-[8px]">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    <th className={DATATABLE_TH}><button type="button" onClick={() => toggleSort('producto')}>Producto</button></th>
                    <th className={DATATABLE_TH}><button type="button" onClick={() => toggleSort('macro')}>Macro</button></th>
                    <th className={DATATABLE_TH}><button type="button" onClick={() => toggleSort('vencimiento')}>Vencimiento</button></th>
                    <th className={`${DATATABLE_TH} text-right`}><button type="button" onClick={() => toggleSort('cantidad')}>Cantidad.</button></th>
                    <th className={`${DATATABLE_TH} text-right`}><button type="button" onClick={() => toggleSort('restante')}>Restante</button></th>
                    <th className={`${DATATABLE_TH} text-right`}><button type="button" onClick={() => toggleSort('vendido')}>Vendido</button></th>
                    <th className={`${DATATABLE_TH} min-w-[200px]`}>
                      Acción realizada / observación
                    </th>
                    <th
                      data-print-hide
                      className={`sticky right-0 z-[2] bg-gray-50 dark:bg-slate-900 ${DATATABLE_TH} text-right`}
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {itemsPaginados.map((r) => {
                    const dias = diasHastaVencimiento(r.fecha_vencimiento);
                    const color = colorVencimiento(dias);
                    const valObs = obsLocal[r.id] ?? r.accion_observacion ?? '';
                    const requiereObs = itemRequiereObservacionDevolucion(r);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                        <td className={DATATABLE_TD}>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{r.descripcion}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            {r.presentacion} · {r.laboratorio}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-600 dark:text-gray-400">{r.codigo_barras}</p>
                          {r.venta_posterior_a_carga ? (
                            <span
                              data-print-hide
                              className="mt-1 ml-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                            >
                              Venta posterior a la carga
                            </span>
                          ) : null}
                          {textoBadgeDrogueriaDevolucion(r.drogueria_devolucion) ? (
                            <span
                              data-print-hide
                              className="mt-1 ml-1 inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                            >
                              {textoBadgeDrogueriaDevolucion(r.drogueria_devolucion)}
                            </span>
                          ) : null}
                          {requiereObs ? (
                            <span
                              data-print-hide
                              className="mt-1 ml-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                            >
                              Observación requerida
                            </span>
                          ) : null}
                        </td>
                        <td className={`${DATATABLE_TD} text-xs text-gray-700 dark:text-gray-300`}>
                          {r.categoria_macro ?? '—'}
                        </td>
                        <td className={`${DATATABLE_TD} text-xs`}>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800 dark:text-gray-200">{formatDate(r.fecha_vencimiento)}</span>
                            <span className={`text-[11px] ${color}`}>
                              {etiquetaDiasHastaVencimiento(dias)}
                            </span>
                          </div>
                        </td>
                        <td className={`${DATATABLE_TD} text-right text-xs tabular-nums text-gray-800 dark:text-gray-200`}>
                          {r.cantidad_cargada_original.toFixed(0)}
                        </td>
                        <td className={`${DATATABLE_TD} text-right text-xs tabular-nums text-gray-800 dark:text-gray-200`}>
                          {Number(r.cantidad ?? 0).toFixed(0)}
                        </td>
                        <td className={`${DATATABLE_TD} text-right text-xs tabular-nums text-gray-800 dark:text-gray-200`}>
                          {r.cantidad_vendida_acumulada.toFixed(0)}
                        </td>
                        <td className={DATATABLE_TD}>
                          <textarea
                            rows={2}
                            value={valObs}
                            onChange={(e) =>
                              setObsLocal((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            placeholder={requiereObs ? 'Obligatoria (vendió menos del 50 %)' : ''}
                            className={`w-full min-w-[200px] resize-y rounded-md border bg-white px-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/30 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-gray-500 ${
                              requiereObs && !valObs.trim()
                                ? 'border-amber-400 dark:border-amber-700'
                                : 'border-gray-300 dark:border-gray-600'
                            }`}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="mt-1"
                            disabled={guardandoId === r.id}
                            onClick={() => void guardarObservacion(r)}
                          >
                            {guardandoId === r.id ? 'Guardando…' : 'Guardar'}
                          </Button>
                        </td>
                        <td
                          data-print-hide
                          className={`sticky right-0 z-[1] bg-white dark:bg-slate-900 ${DATATABLE_TD} text-right`}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void marcarVendido(r.id, Number(r.cantidad ?? 0))}
                          >
                            Vendido
                          </Button>
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
