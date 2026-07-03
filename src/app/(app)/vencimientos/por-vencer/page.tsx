'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Filter,
  Trash2,
} from 'lucide-react';
import { clientHasPermission } from '@/lib/auth/permissions-client';
import PorVencerListMobile from '@/components/vencimientos/PorVencerListMobile';
import { PorVencerFiltrosPanel } from '@/components/vencimientos/PorVencerFiltrosPanel';
import {
  PorVencerDatatableBar,
  PorVencerDatatableFooter,
  type TamPaginaPorVencer,
} from '@/components/vencimientos/PorVencerDatatableBar';
import { VencimientosTablaContenedor } from '@/components/vencimientos/VencimientosTablaContenedor';
import { TablaImpresionVencimientosCompacta } from '@/components/vencimientos/TablaImpresionVencimientosCompacta';
import {
  MESES_CALENDARIO,
  opcionesAnioVencimiento,
  pasaFiltroMesAnioYmd,
  validarAnioVencFiltro,
  validarMesVencFiltro,
} from '@/lib/vencimientos-mes-anio-filtro';
import {
  BotonImprimirListadoVencimientos,
  EncabezadoImpresionListadoVencimientos,
  VENCIMIENTOS_PRINT_AREA_ATTR,
} from '@/components/vencimientos/ImprimirListadoVencimientos';
import {
  filtrarPorVencerPorPeriodo,
  periodoCubiertoPorCache,
} from '@/lib/vencimientos/por-vencer-filtro-periodo';
import {
  fusionarFlagsVentaPosteriorEnItems,
  guardarFlagsVentaPosteriorSesion,
  leerFlagsVentaPosteriorSesion,
  marcarVentaPosteriorCheckSesion,
  ventaPosteriorCheckHechoEnSesion,
} from '@/lib/vencimientos/por-vencer-venta-posterior-cache';
import type { VistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';
import { usePaginacionServidor, useTotalPaginas } from '@/components/list/datatable-pagination';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_PAGE_ROOT,
  DATATABLE_SCROLL_SCREEN,
  DATATABLE_SECTION_CLASS,
  DATATABLE_STICKY_THEAD,
} from '@/components/list/datatable-classes';
import { tamPaginaToPageSizeParam } from '@/lib/api/pagination';

const TAM_PAGINA_DEFAULT: TamPaginaPorVencer = 20;

type SortKeyPorVencer =
  | 'producto'
  | 'categoria'
  | 'carga'
  | 'vencimiento'
  | 'restante'
  | 'vendido';

function valorItemPorVencer(item: PorVencerItem, sortKey: SortKeyPorVencer): string | number {
  const rest = Number(item.cantidad ?? 0);
  const vend = Number(item.cantidad_vendida_acumulada ?? 0);
  if (sortKey === 'producto') return String(item.descripcion ?? '').toLowerCase();
  if (sortKey === 'categoria') return String(item.categoria ?? '').toLowerCase();
  if (sortKey === 'carga') return String(item.fecha_registro ?? '');
  if (sortKey === 'vencimiento') return String(item.fecha_vencimiento ?? '');
  if (sortKey === 'restante') return rest;
  return vend;
}

function compararValoresSort(
  va: string | number,
  vb: string | number,
  sortDir: 'asc' | 'desc'
): number {
  let cmp = 0;
  if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
  else cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
  return sortDir === 'asc' ? cmp : -cmp;
}

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
  const [itemsImpresion, setItemsImpresion] = useState<PorVencerItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);
  const [daysMin, setDaysMin] = useState(0);
  const [rol, setRol] = useState<'superadmin' | 'admin' | 'operador_sucursal'>('operador_sucursal');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [gruposExpandidos, setGruposExpandidos] = useState<Record<string, boolean>>({});
  const [obsLocal, setObsLocal] = useState<Record<string, string>>({});
  const [guardandoObsId, setGuardandoObsId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKeyPorVencer>('vencimiento');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [totalFilas, setTotalFilas] = useState(0);
  const [totalLineas, setTotalLineas] = useState(0);
  const [catMacrosDisponibles, setCatMacrosDisponibles] = useState<string[]>([]);
  const [categoriasDisponibles, setCategoriasDisponibles] = useState<string[]>([]);
  const [laboratoriosDisponibles, setLaboratoriosDisponibles] = useState<string[]>([]);
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [ventaPosteriorCheckStatus, setVentaPosteriorCheckStatus] = useState<
    'off' | 'full' | 'skipped_slow_db' | 'skipped_unavailable'
  >('off');
  const [rangeKey, setRangeKey] = useState<
    'all' | '30_all' | '60_all' | '90_all' | '30_only' | '60_only' | '90_only'
  >('all');
  /**
   * Chequeo MySQL (onze_center) solo la primera vez por sesión del navegador.
   * Filtros de periodo/vista reutilizan datos ya cargados cuando el rango es más acotado.
   * «Actualizar» limpia cachés y vuelve a consultar todo (incl. venta posterior).
   */
  const ventaPosteriorCacheRef = useRef<Map<string, boolean>>(new Map());
  const ventaPosteriorCheckHechoRef = useRef(false);
  const cachePorVistaRef = useRef<
    Map<string, { days: number; daysMin: number; items: PorVencerItem[] }>
  >(new Map());

  function parseVistaDesdeUrl(raw: string | null): VistaPorVencerList {
    if (raw === 'vendidos' || raw === 'vencidos' || raw === 'vendido_parcial') return raw;
    return 'por_vencer';
  }

  function aplicarFlagsVentaPosterior(lista: PorVencerItem[]): PorVencerItem[] {
    return fusionarFlagsVentaPosteriorEnItems(lista, ventaPosteriorCacheRef.current);
  }

  function invalidarCachePorVencer() {
    cachePorVistaRef.current.clear();
  }

  const vistaUrl = searchParams.get('vista');
  const vistaSelect =
    vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial'
      ? vistaUrl
      : 'por_vencer';

  const catMacroFiltro = searchParams.get('cat_macro') ?? '';
  const categoriaFiltro = searchParams.get('categoria') ?? '';
  const laboratorioFiltro = searchParams.get('laboratorio') ?? '';
  const soloVentaPosterior = searchParams.get('solo_venta_posterior') === '1';
  const mesVencFiltro = parseInt(searchParams.get('mes_venc') ?? '', 10);
  const anioVencFiltro = parseInt(searchParams.get('anio_venc') ?? '', 10);
  const anioVencValido = validarAnioVencFiltro(
    Number.isFinite(anioVencFiltro) ? anioVencFiltro : undefined
  );
  const mesVencValido = validarMesVencFiltro(
    Number.isFinite(mesVencFiltro) ? mesVencFiltro : undefined,
    anioVencValido ?? null
  );
  const mesesVencOpts = MESES_CALENDARIO;
  const aniosVencOpts = useMemo(() => opcionesAnioVencimiento(3, 5), []);

  const {
    paginaActual,
    setPaginaActual,
    tamPagina,
    onTamPaginaChange,
  } = usePaginacionServidor([
    searchParams.toString(),
    busquedaAplicada,
    sortKey,
    sortDir,
    catMacroFiltro,
    categoriaFiltro,
    laboratorioFiltro,
    soloVentaPosterior,
    mesVencValido,
    anioVencValido,
  ]);
  const totalPaginas = useTotalPaginas(totalFilas, tamPagina);

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
    if (vistaSelect === 'vendido_parcial') return `${base} — solo vendido parcial (no liquidado)`;
    if (vistaSelect === 'vencidos') return `Productos vencidos (${desdeHastaLabel} hacia atrás)`;
    return base;
  }, [desdeHastaLabel, vistaSelect]);

  const filtrosActivos = useMemo(() => {
    let n = 0;
    if (vistaSelect !== 'por_vencer') n += 1;
    if (rangeKey !== 'all') n += 1;
    if (catMacroFiltro) n += 1;
    if (categoriaFiltro) n += 1;
    if (laboratorioFiltro) n += 1;
    if (soloVentaPosterior) n += 1;
    if (mesVencValido) n += 1;
    if (anioVencValido) n += 1;
    return n;
  }, [
    vistaSelect,
    rangeKey,
    catMacroFiltro,
    categoriaFiltro,
    laboratorioFiltro,
    soloVentaPosterior,
    mesVencValido,
    anioVencValido,
  ]);

  const itemsFiltrados = items;

  type FilaAgrupada =
    | { tipo: 'uno'; item: PorVencerItem }
    | { tipo: 'grupo'; key: string; items: PorVencerItem[] };

  function toggleSort(key: SortKeyPorVencer) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'vencimiento' || key === 'carga' ? 'asc' : 'desc');
  }

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
    return filas;
  }, [itemsFiltrados]);

  const filasPaginadas = filasAgrupadas;

  const ordenarItemsGrupo = useCallback(
    (items: PorVencerItem[]) =>
      [...items].sort((a, b) =>
        compararValoresSort(
          valorItemPorVencer(a, sortKey),
          valorItemPorVencer(b, sortKey),
          sortDir
        )
      ),
    [sortDir, sortKey]
  );

  function encabezadoSort(
    key: SortKeyPorVencer,
    label: string,
    opts?: { align?: 'left' | 'right'; className?: string }
  ) {
    const align = opts?.align ?? 'left';
    const activo = sortKey === key;
    return (
      <th
        scope="col"
        className={`px-3 py-2 font-medium text-gray-600 dark:text-gray-300 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-slate-800 ${
          align === 'right' ? 'text-right' : 'text-left'
        } ${opts?.className ?? ''}`}
        onClick={() => toggleSort(key)}
        aria-sort={activo ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span
          className={`inline-flex items-center gap-1 ${align === 'right' ? 'ml-auto justify-end' : ''}`}
        >
          {label}
          {activo ? (
            sortDir === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )
          ) : null}
        </span>
      </th>
    );
  }

  function sincronizarRangeKey(daysParam: number, daysMinParam: number) {
    if (daysParam === 365 && daysMinParam === 0) setRangeKey('all');
    else if (daysParam === 30 && daysMinParam === 0) setRangeKey('30_all');
    else if (daysParam === 30 && daysMinParam === 1) setRangeKey('30_only');
    else if (daysParam === 60 && daysMinParam === 31) setRangeKey('60_only');
    else if (daysParam === 60 && daysMinParam === 0) setRangeKey('60_all');
    else if (daysParam === 90 && daysMinParam === 61) setRangeKey('90_only');
    else if (daysParam === 90 && daysMinParam === 0) setRangeKey('90_all');
    else setRangeKey('all');
  }

  async function cargar(opciones?: { forzarApi?: boolean }) {
    setLoading(true);
    setError('');
    try {
      const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      const vista = parseVistaDesdeUrl(searchParams.get('vista'));
      setDays(daysParam);
      setDaysMin(daysMinParam);
      sincronizarRangeKey(daysParam, daysMinParam);

      if (opciones?.forzarApi) {
        invalidarCachePorVencer();
      }

      const params = new URLSearchParams();
      params.set('days', String(daysParam));
      params.set('daysMin', String(daysMinParam));
      if (vista !== 'por_vencer') {
        params.set('vista', vista);
      }
      if (catMacroFiltro) params.set('cat_macro', catMacroFiltro);
      if (categoriaFiltro) params.set('categoria', categoriaFiltro);
      if (laboratorioFiltro) params.set('laboratorio', laboratorioFiltro);
      if (soloVentaPosterior) params.set('solo_venta_posterior', '1');
      if (mesVencValido) params.set('mes_venc', String(mesVencValido));
      if (anioVencValido) params.set('anio_venc', String(anioVencValido));
      if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
      params.set('sortBy', sortKey);
      params.set('sortDir', sortDir);
      params.set('page', String(paginaActual));
      params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));

      const checkYaHecho =
        ventaPosteriorCheckHechoRef.current || ventaPosteriorCheckHechoEnSesion();
      const solicitarCheckVentaPosterior =
        opciones?.forzarApi || (!checkYaHecho && !soloVentaPosterior);
      if (solicitarCheckVentaPosterior) {
        ventaPosteriorCheckHechoRef.current = true;
        marcarVentaPosteriorCheckSesion(true);
        params.set('check_venta_posterior', '1');
      }

      const res = await fetch(`/api/vencimientos/por-vencer?${params.toString()}`);
      const json = await res.json() as {
        data?: PorVencerItem[];
        total?: number;
        total_lineas?: number;
        cat_macros?: string[];
        categorias?: string[];
        laboratorios?: string[];
        error?: string;
        venta_posterior_check?: 'off' | 'full' | 'skipped_slow_db' | 'skipped_unavailable';
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar productos por vencer');
        setItems([]);
        setTotalFilas(0);
        setTotalLineas(0);
        return;
      }

      const rawList = json.data ?? [];
      if (solicitarCheckVentaPosterior) {
        for (const i of rawList) {
          ventaPosteriorCacheRef.current.set(i.id, !!i.venta_posterior_a_carga);
        }
        guardarFlagsVentaPosteriorSesion(ventaPosteriorCacheRef.current);
        if (json.venta_posterior_check) {
          setVentaPosteriorCheckStatus(json.venta_posterior_check);
        }
      } else if (json.venta_posterior_check === 'off') {
        for (const i of rawList) {
          if (!ventaPosteriorCacheRef.current.has(i.id) && i.venta_posterior_a_carga) {
            ventaPosteriorCacheRef.current.set(i.id, true);
          }
        }
        guardarFlagsVentaPosteriorSesion(ventaPosteriorCacheRef.current);
      }

      setItems(aplicarFlagsVentaPosterior(rawList));
      setTotalFilas(json.total ?? 0);
      setTotalLineas(json.total_lineas ?? json.total ?? 0);
      setCatMacrosDisponibles(json.cat_macros ?? []);
      setCategoriasDisponibles(json.categorias ?? []);
      setLaboratoriosDisponibles(json.laboratorios ?? []);
      setObsLocal({});
    } catch {
      setError('Error al cargar productos por vencer');
      setItems([]);
      setTotalFilas(0);
      setTotalLineas(0);
    } finally {
      setLoading(false);
    }
  }

  const prepararImpresion = useCallback(async () => {
    if (tamPagina === 'all' && items.length >= totalLineas && totalLineas > 0) {
      setItemsImpresion(null);
      return;
    }
    const daysParam = parseInt(searchParams.get('days') ?? '365', 10) || 365;
    const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
    const vista = parseVistaDesdeUrl(searchParams.get('vista'));
    const params = new URLSearchParams();
    params.set('days', String(daysParam));
    params.set('daysMin', String(daysMinParam));
    if (vista !== 'por_vencer') params.set('vista', vista);
    if (catMacroFiltro) params.set('cat_macro', catMacroFiltro);
    if (categoriaFiltro) params.set('categoria', categoriaFiltro);
    if (laboratorioFiltro) params.set('laboratorio', laboratorioFiltro);
    if (soloVentaPosterior) params.set('solo_venta_posterior', '1');
    if (mesVencValido) params.set('mes_venc', String(mesVencValido));
    if (anioVencValido) params.set('anio_venc', String(anioVencValido));
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada);
    params.set('sortBy', sortKey);
    params.set('sortDir', sortDir);
    params.set('page', '1');
    params.set('pageSize', 'all');
    params.set('check_venta_posterior', '0');
    const res = await fetch(`/api/vencimientos/por-vencer?${params.toString()}`);
    const json = (await res.json()) as { data?: PorVencerItem[]; error?: string };
    if (!res.ok) throw new Error(json.error ?? 'Error al preparar impresión');
    setItemsImpresion(aplicarFlagsVentaPosterior(json.data ?? []));
  }, [
    tamPagina,
    items.length,
    totalLineas,
    searchParams,
    catMacroFiltro,
    categoriaFiltro,
    laboratorioFiltro,
    soloVentaPosterior,
    mesVencValido,
    anioVencValido,
    busquedaAplicada,
    sortKey,
    sortDir,
  ]);

  const claveCargaDatos = [
    searchParams.get('days') ?? '365',
    searchParams.get('daysMin') ?? '0',
    searchParams.get('vista') ?? '',
    catMacroFiltro,
    categoriaFiltro,
    laboratorioFiltro,
    soloVentaPosterior ? '1' : '0',
    mesVencValido ?? '',
    anioVencValido ?? '',
    busquedaAplicada,
    sortKey,
    sortDir,
    String(paginaActual),
    String(tamPagina),
  ].join('|');

  useEffect(() => {
    setItemsImpresion(null);
  }, [claveCargaDatos]);

  useEffect(() => {
    if (ventaPosteriorCheckHechoEnSesion()) {
      ventaPosteriorCheckHechoRef.current = true;
      ventaPosteriorCacheRef.current = leerFlagsVentaPosteriorSesion();
    }
  }, []);

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
  }, [claveCargaDatos]);

  useEffect(() => {
    async function cargarRol() {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (json?.data?.rol) {
          setRol(json.data.rol);
        }
        if (Array.isArray(json?.data?.permissions)) {
          setPermissions(json.data.permissions);
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
      invalidarCachePorVencer();
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

  async function arreglarCantidadVendida(
    detalleId: string,
    cantidadRestante: number,
    cantidadVendidaActual: number
  ) {
    const rest = Math.max(0, Math.floor(Number(cantidadRestante) || 0));
    const vendida = Math.max(0, Math.floor(Number(cantidadVendidaActual) || 0));
    const totalLinea = rest + vendida;
    if (totalLinea <= 0 || vendida <= 0) {
      setError('Esta línea no tiene ventas registradas para corregir.');
      return;
    }
    const ingresado = window.prompt(
      `Cantidad vendida correcta (0 a ${totalLinea}).\nCargada en la línea: ${totalLinea} · Registrada vendida: ${vendida} · Restante: ${rest}`,
      String(vendida)
    );
    if (ingresado == null) return;
    const nuevaVendida = parseInt(ingresado, 10);
    if (!Number.isFinite(nuevaVendida) || nuevaVendida < 0 || nuevaVendida > totalLinea) {
      setError(`Ingresá un entero entre 0 y ${totalLinea}.`);
      return;
    }
    if (nuevaVendida === vendida) {
      setError('La cantidad ingresada es igual a la vendida actual.');
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/vencimientos/por-vencer/ajustar-vendido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detalle_id: detalleId,
          cantidad_vendida_total: nuevaVendida,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        cantidad_vendida_total?: number;
        cantidad_restante?: number;
        vendido?: number;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al ajustar la cantidad vendida');
        return;
      }
      const vendidaFinal = Number(json.cantidad_vendida_total ?? nuevaVendida);
      const restanteFinal = Number(json.cantidad_restante ?? totalLinea - nuevaVendida);
      const vendidoFlag = Number(json.vendido ?? (restanteFinal <= 0 ? 1 : 0));
      invalidarCachePorVencer();
      setItems((prev) =>
        prev.map((x) =>
          x.id === detalleId
            ? {
                ...x,
                cantidad: restanteFinal,
                cantidad_vendida_acumulada: vendidaFinal,
                vendido: vendidoFlag,
              }
            : x
        )
      );
    } catch {
      setError('Error al ajustar la cantidad vendida');
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
      invalidarCachePorVencer();
      await cargar({ forzarApi: true });
    } catch {
      setError('Error al quitar cantidad');
    }
  }

  function textoObs(item: { id: string; accion_observacion?: string | null }) {
    if (obsLocal[item.id] !== undefined) return obsLocal[item.id];
    return String(item.accion_observacion ?? '');
  }

  async function guardarObservacion(item: { id: string; accion_observacion?: string | null }) {
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
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{tituloPrincipal}</h1>
        </div>
        <div className="flex items-center gap-2">
          {(clientHasPermission(permissions, rol, 'vencimientos.consolidado') ||
            clientHasPermission(permissions, rol, 'vencimientos.descuentos')) && (
            <>
              <Link
                href={`/vencimientos/por-vencer/consolidado?consolidado=1&days=${searchParams.get('days') ?? '365'}&daysMin=${searchParams.get('daysMin') ?? '0'}${vistaUrl === 'vendidos' || vistaUrl === 'vencidos' || vistaUrl === 'vendido_parcial' ? `&vista=${encodeURIComponent(vistaUrl)}` : ''}${mesVencValido ? `&mes_venc=${mesVencValido}` : ''}${anioVencValido ? `&anio_venc=${anioVencValido}` : ''}`}
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

      {(ventaPosteriorCheckStatus === 'skipped_slow_db' ||
        ventaPosteriorCheckStatus === 'skipped_unavailable') && (
        <div className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 print:hidden">
          {ventaPosteriorCheckStatus === 'skipped_slow_db'
            ? 'La base onze_center respondió lento. Se omitió la verificación de ventas posteriores para cargar el listado más rápido.'
            : 'No se pudo consultar onze_center a tiempo. Se omitió la verificación de ventas posteriores.'}{' '}
          Usá «Actualizar» para reintentar.
        </div>
      )}

      <Card
        className={DATATABLE_CARD_CLASS}
        {...{ [VENCIMIENTOS_PRINT_AREA_ATTR]: '' }}
      >
        <CardHeader className="shrink-0 py-3 print:hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={filtrosAbiertos ? 'secondary' : 'outline'}
                onClick={() => setFiltrosAbiertos((v) => !v)}
              >
                <Filter className="h-4 w-4 mr-1" />
                Filtros
                {filtrosActivos > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
                    {filtrosActivos}
                  </span>
                ) : null}
              </Button>
              <BotonImprimirListadoVencimientos
                disabled={loading || totalLineas === 0}
                onPreparePrint={prepararImpresion}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <EncabezadoImpresionListadoVencimientos
            titulo={tituloPrincipal}
            detalle={`Periodo: ${desdeHastaLabel}${catMacroFiltro ? ` · Macro: ${catMacroFiltro}` : ''}${categoriaFiltro ? ` · Categoría: ${categoriaFiltro}` : ''}${laboratorioFiltro ? ` · Laboratorio: ${laboratorioFiltro}` : ''}`}
            cantidadRegistros={totalLineas}
          />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <PorVencerFiltrosPanel
              abierto={filtrosAbiertos}
              onCerrar={() => setFiltrosAbiertos(false)}
              vistaSelect={vistaSelect}
              rangeKey={rangeKey}
              catMacroFiltro={catMacroFiltro}
              categoriaFiltro={categoriaFiltro}
              laboratorioFiltro={laboratorioFiltro}
              soloVentaPosterior={soloVentaPosterior}
              mesVencValido={mesVencValido}
              anioVencValido={anioVencValido}
              mesesVencOpts={mesesVencOpts}
              aniosVencOpts={aniosVencOpts}
              catMacrosDisponibles={catMacrosDisponibles}
              categoriasDisponibles={categoriasDisponibles}
              laboratoriosDisponibles={laboratoriosDisponibles}
              loading={loading}
              onActualizar={() => {
                ventaPosteriorCheckHechoRef.current = false;
                ventaPosteriorCacheRef.current.clear();
                marcarVentaPosteriorCheckSesion(false);
                invalidarCachePorVencer();
                void cargar({ forzarApi: true });
              }}
            />
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : (
            <div className={`${DATATABLE_SECTION_CLASS} print:min-h-0 print:flex-none print:overflow-visible`}>
              <PorVencerDatatableBar
                busquedaTexto={busquedaAplicada}
                onBusquedaChange={(v) => setBusquedaAplicada(v.trim())}
                tamPagina={tamPagina}
                onTamPaginaChange={onTamPaginaChange}
                paginaActual={paginaActual}
                onPaginaChange={setPaginaActual}
                totalFilas={totalFilas}
              />
              {totalFilas === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500">
                  {vistaSelect === 'vendidos' && 'No hay productos liquidados en ese rango.'}
                  {vistaSelect === 'vencidos' &&
                    'No hay productos vencidos sin liquidar en ese rango.'}
                  {vistaSelect === 'vendido_parcial' &&
                    'No hay líneas con venta parcial sin liquidar en ese rango.'}
                  {vistaSelect === 'por_vencer' &&
                    'No hay productos por vencer con los filtros actuales.'}
                </p>
              ) : (
              <>
              <div className="datatable-rows-scroll row-start-2 min-h-0 overflow-auto overscroll-contain md:hidden print:hidden">
                <PorVencerListMobile
                  filas={filasPaginadas}
                  gruposExpandidos={gruposExpandidos}
                  onToggleGrupo={(key) =>
                    setGruposExpandidos((p) => ({ ...p, [key]: !p[key] }))
                  }
                  textoObs={textoObs}
                  onObsChange={(id, value) =>
                    setObsLocal((prev) => ({ ...prev, [id]: value }))
                  }
                  guardandoObsId={guardandoObsId}
                  onGuardarObs={(item) => void guardarObservacion(item)}
                  onVendido={(id, cant) => void eliminarRegistro(id, cant)}
                  onReducirCarga={(id, cant) => void reducirCarga(id, cant)}
                  onArreglarVendido={(id, rest, vend) =>
                    void arreglarCantidadVendida(id, rest, vend)
                  }
                  ordenarItemsGrupo={(items) => ordenarItemsGrupo(items as PorVencerItem[])}
                />
              </div>
              <TablaImpresionVencimientosCompacta items={itemsImpresion ?? items} />
              <VencimientosTablaContenedor className={DATATABLE_SCROLL_SCREEN}>
              <table className="w-full min-w-[960px] text-sm print:min-w-0 print:text-[8px]">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    {encabezadoSort('producto', 'Producto')}
                    {encabezadoSort('categoria', 'Categoría', {
                      className: 'hidden lg:table-cell',
                    })}
                    {encabezadoSort('carga', 'Carga', {
                      className: 'hidden xl:table-cell',
                    })}
                    {encabezadoSort('vencimiento', 'Vencimiento')}
                    {encabezadoSort('restante', 'Rest.', { align: 'right' })}
                    {encabezadoSort('vendido', 'Vend.', { align: 'right' })}
                    <th className="hidden px-3 py-2 text-right font-medium text-gray-600 xl:table-cell dark:text-gray-300">
                      Desc.
                    </th>
                    <th
                      data-print-hide
                      className="min-w-[220px] px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300"
                    >
                      Observación y acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filasPaginadas.map((fila) => {
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
                              {r.codigo_barras}
                            </p>
                            {r.venta_posterior_a_carga ? (
                              <p className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                Venta posterior a la carga
                              </p>
                            ) : null}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-xs text-gray-700 lg:table-cell dark:text-gray-300">
                            {r.categoria ?? '-'}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-xs whitespace-nowrap text-gray-700 xl:table-cell dark:text-gray-300">
                            {formatDateTime(r.fecha_registro)}
                          </td>
                          <td className="px-3 py-2 align-top text-xs">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-800 dark:text-gray-200">{formatDate(r.fecha_vencimiento)}</span>
                              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                                {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                              </span>
                              <span className="text-[10px] text-gray-500 xl:hidden">
                                Carga: {formatDateTime(r.fecha_registro)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                            {Number(r.cantidad ?? 0).toFixed(0)}
                          </td>
                          <td className="px-4 py-2 align-top text-right text-xs text-gray-800 dark:text-gray-200">
                            {vendHist.toFixed(0)}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-right text-xs xl:table-cell">
                            {typeof r.descuento_aplicado === 'number' ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                                -{Math.abs(r.descuento_aplicado)}%
                              </span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500">-</span>
                            )}
                          </td>
                          <td data-print-hide className="min-w-[220px] px-3 py-2 align-top">
                            <textarea
                              rows={2}
                              value={textoObs(r)}
                              onChange={(e) =>
                                setObsLocal((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              className="w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
                              placeholder="Acción tomada..."
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={guardandoObsId === r.id}
                                onClick={() => void guardarObservacion(r)}
                              >
                                {guardandoObsId === r.id ? 'Guardando…' : 'Guardar'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={liquidado}
                                onClick={() => void eliminarRegistro(r.id, Number(r.cantidad ?? 0))}
                              >
                                Vendido
                              </Button>
                              {vendHist > 0 ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Corregir unidades vendidas registradas por error"
                                  onClick={() =>
                                    void arreglarCantidadVendida(
                                      r.id,
                                      Number(r.cantidad ?? 0),
                                      vendHist
                                    )
                                  }
                                >
                                  Arreglar vendido
                                </Button>
                              ) : null}
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
                              {primero.codigo_barras}
                            </p>
                            {grp.some((x) => x.venta_posterior_a_carga) ? (
                              <p className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                Venta posterior a la carga
                              </p>
                            ) : null}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-xs text-gray-700 lg:table-cell dark:text-gray-300">
                            {primero.categoria ?? '-'}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-xs text-gray-600 xl:table-cell dark:text-gray-400">
                            Varias cargas
                          </td>
                          <td className="px-3 py-2 align-top text-xs">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-800 dark:text-gray-200">{formatDate(primero.fecha_vencimiento)}</span>
                              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                                {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top text-right text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {restG.toFixed(0)}
                          </td>
                          <td className="px-3 py-2 align-top text-right text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {vendG.toFixed(0)}
                          </td>
                          <td className="hidden px-3 py-2 align-top text-right text-xs xl:table-cell">
                            {descTodosIguales && typeof desc0 === 'number' ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                                -{Math.abs(desc0)}%
                              </span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500">-</span>
                            )}
                          </td>
                          <td data-print-hide className="min-w-[220px] px-3 py-2 align-top">
                            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                              Varias cargas — editá por línea
                            </p>
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
                              {exp ? 'Ocultar líneas' : `Ver ${grp.length} líneas`}
                            </Button>
                          </td>
                        </tr>
                        {exp
                          ? ordenarItemsGrupo(grp).map((r) => {
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
                                  <td className="px-3 py-2 pl-8 align-top text-xs text-gray-600 dark:text-gray-400">
                                    Línea · control {r.control_id.slice(0, 8)}…
                                  </td>
                                  <td className="hidden px-3 py-2 align-top text-xs text-gray-500 lg:table-cell dark:text-gray-500">
                                    {r.categoria ?? '-'}
                                  </td>
                                  <td className="hidden px-3 py-2 align-top text-xs whitespace-nowrap text-gray-600 xl:table-cell dark:text-gray-400">
                                    {r.fecha_registro ? formatDateTime(r.fecha_registro) : '—'}
                                  </td>
                                  <td className="px-3 py-2 align-top text-xs">
                                    <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${col}`}>
                                      {formatDate(r.fecha_vencimiento)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 align-top text-right text-xs">{rest.toFixed(0)}</td>
                                  <td className="px-3 py-2 align-top text-right text-xs">{vh.toFixed(0)}</td>
                                  <td className="hidden px-3 py-2 align-top text-right text-xs xl:table-cell">
                                    {typeof r.descuento_aplicado === 'number' ? (
                                      <span className="text-emerald-700 dark:text-emerald-300">
                                        -{Math.abs(r.descuento_aplicado)}%
                                      </span>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                  <td data-print-hide className="min-w-[220px] px-3 py-2 align-top">
                                    <textarea
                                      rows={2}
                                      value={textoObs(r)}
                                      onChange={(e) =>
                                        setObsLocal((prev) => ({ ...prev, [r.id]: e.target.value }))
                                      }
                                      className="w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
                                      placeholder="Acción tomada..."
                                    />
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={guardandoObsId === r.id}
                                        onClick={() => void guardarObservacion(r)}
                                      >
                                        {guardandoObsId === r.id ? 'Guardando…' : 'Guardar'}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={liq}
                                        onClick={() => void eliminarRegistro(r.id, Number(r.cantidad ?? 0))}
                                      >
                                        Vendido
                                      </Button>
                                      {vh > 0 ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          title="Corregir unidades vendidas registradas por error"
                                          onClick={() =>
                                            void arreglarCantidadVendida(
                                              r.id,
                                              Number(r.cantidad ?? 0),
                                              vh
                                            )
                                          }
                                        >
                                          Arreglar vendido
                                        </Button>
                                      ) : null}
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
                                    {r.venta_posterior_a_carga ? (
                                      <p className="mt-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                        Venta posterior a la carga
                                      </p>
                                    ) : null}
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
            </VencimientosTablaContenedor>
              <PorVencerDatatableFooter
                paginaActual={paginaActual}
                onPaginaChange={setPaginaActual}
                totalFilas={totalFilas}
                tamPagina={tamPagina}
                detalle={`${totalFilas} fila${totalFilas !== 1 ? 's' : ''} (${totalLineas} línea${totalLineas !== 1 ? 's' : ''})`}
              />
              </>
              )}
            </div>
          )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

