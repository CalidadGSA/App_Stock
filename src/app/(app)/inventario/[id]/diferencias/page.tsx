'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import {
  bloquearCampoUnidadesInventario,
} from '@/lib/inventario/fraccionable';
import {
  esCantidadStockValida,
  mensajeCantidadStockInvalida,
} from '@/lib/inventario/stock-cantidad';
import {
  MAX_STOCK_REAL_CAJAS,
  MAX_STOCK_REAL_UNIDADES,
  mensajeMaxStockRealCajas,
  mensajeMaxStockRealUnidades,
} from '@/lib/inventario/stock-limits';
import {
  esTipoAuditoria,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { esAjusteSucursalInversoAuditoria } from '@/lib/inventario/diferencia-sucursal-auditoria';
import { formatDateTime } from '@/lib/utils';
import { formatearUbicacionDrogueria } from '@/lib/inventario/ubicacion-drogueria';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import type {
  ControlInventario,
  ControlInventarioDetalle,
  ProductoLegacy,
} from '@/types';

interface ControlConDetalles extends ControlInventario {
  controles_inventario_detalle: ControlInventarioDetalle[];
  es_drogueria?: boolean;
}

/** Con código de barras: bloquear unidades mientras carga o si no admite unidades sueltas. */
function debeBloquearUnidadesStockReal(
  codigoBarras: string | null | undefined,
  prod: ProductoLegacy | null | undefined,
  /** Preferir unidades del detalle/histórico; la ficha básica no trae stock live. */
  stockUnidadesReferencia?: number | null
): boolean {
  if (!codigoBarras || String(codigoBarras).trim() === '') return false;
  if (prod === undefined) return true;
  if (prod === null) return true;
  return bloquearCampoUnidadesInventario(
    prod.fraccionable,
    stockUnidadesReferencia ?? prod.stock_unidades
  );
}

type LineaEdit = {
  sistCajas: string;
  sistUnidades: string;
  realCajas: string;
  realUnidades: string;
};

type LineaBaseline = {
  sistCajas: number;
  sistUnidades: number;
  realCajas: number;
  realUnidades: number;
};

function parseCantidad(value: string): number {
  const t = value.trim();
  return t === '' ? 0 : parseFloat(t);
}

function inferirUnidadesPorCaja(
  detalle: ControlInventarioDetalle,
  sistCajas: number,
  sistUnidades: number,
  prod?: ProductoLegacy | null
): number {
  if (prod?.unidades_por_caja && !Number.isNaN(prod.unidades_por_caja) && prod.unidades_por_caja > 0) {
    return prod.unidades_por_caja;
  }
  if (
    sistCajas > 0 &&
    sistUnidades >= 0 &&
    detalle.stock_sistema != null
  ) {
    const num = Number(detalle.stock_sistema) - sistUnidades;
    const den = sistCajas;
    if (den > 0) {
      const estimado = num / den;
      if (Number.isFinite(estimado) && estimado > 0) return estimado;
    }
  }
  return 1;
}

function CeldaDiferenciaCajasUnidades({
  diffCajas,
  diffUnidades,
}: {
  diffCajas: number | null | undefined;
  diffUnidades: number | null | undefined;
}) {
  if (diffCajas == null && diffUnidades == null) {
    return <span className="text-gray-400">—</span>;
  }
  const c = Number(diffCajas ?? 0);
  const u = Number(diffUnidades ?? 0);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={`inline-flex items-center gap-0.5 font-semibold ${
          c === 0 ? 'text-gray-500' : c > 0 ? 'text-blue-600' : 'text-red-600'
        }`}
      >
        {c > 0 ? <TrendingUp className="h-3 w-3" /> : c < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        {c > 0 ? '+' : ''}
        {c}
      </span>
      <span
        className={`inline-flex items-center gap-0.5 font-semibold ${
          u === 0 ? 'text-gray-500' : u > 0 ? 'text-blue-600' : 'text-red-600'
        }`}
      >
        {u > 0 ? <TrendingUp className="h-3 w-3" /> : u < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        {u > 0 ? '+' : ''}
        {u}
      </span>
    </div>
  );
}

export default function InventarioDiferenciasPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const notify = useAppNotify();

  const [control, setControl] = useState<ControlConDetalles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [detalleSeleccionadoId, setDetalleSeleccionadoId] = useState<string | null>(null);

  const [productosPorBarcode, setProductosPorBarcode] = useState<
    Record<string, ProductoLegacy | null>
  >({});
  /** Stock live Plex/Quantio por producto_id_sistema (undefined = no pedido / en curso). */
  const [stockLivePorProductoId, setStockLivePorProductoId] = useState<
    Record<string, { cajas: number; unidades: number; unidades_por_caja?: number } | null>
  >({});
  const fichasSolicitadasRef = useRef<Set<string>>(new Set());
  const stockLiveSolicitadoRef = useRef<Set<string>>(new Set());
  /** Líneas donde el usuario ya tocó stock sistema: no sobrescribir con live. */
  const sistEditadoManualRef = useRef<Set<string>>(new Set());
  const editsRef = useRef<Record<string, LineaEdit>>({});
  const baselinesRef = useRef<Record<string, LineaBaseline>>({});

  const [edits, setEdits] = useState<Record<string, LineaEdit>>({});
  const [baselines, setBaselines] = useState<Record<string, LineaBaseline>>({});

  editsRef.current = edits;
  baselinesRef.current = baselines;

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch(`/api/inventario/${id}`);
        const json = (await res.json()) as { data?: ControlConDetalles; error?: string };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar control');
          return;
        }
        setControl(json.data!);
      } catch {
        setError('Error al cargar control');
      } finally {
        setLoading(false);
      }
    }
    cargar();
  }, [id]);

  async function fetchFichaBasica(bc: string): Promise<ProductoLegacy | null> {
    try {
      const res = await fetch(`/api/productos/basico/${encodeURIComponent(bc)}`);
      const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
      return res.ok ? json.data ?? null : null;
    } catch {
      return null;
    }
  }

  function claveStockLive(det: Pick<ControlInventarioDetalle, 'producto_id_sistema' | 'codigo_barras'>) {
    const id = String(det.producto_id_sistema ?? '').trim();
    if (id) return id;
    return String(det.codigo_barras ?? '').trim();
  }

  async function fetchStockLive(det: Pick<ControlInventarioDetalle, 'producto_id_sistema' | 'codigo_barras'>): Promise<{
    cajas: number;
    unidades: number;
    unidades_por_caja?: number;
    producto: ProductoLegacy | null;
  } | null> {
    try {
      const id = String(det.producto_id_sistema ?? '').trim();
      // Preferir ID Plex del detalle (mismo que MySQL stock.IDProducto).
      // Fallback a barcode si no hay id.
      const url = id
        ? `/api/productos/id/${encodeURIComponent(id)}`
        : det.codigo_barras?.trim()
          ? `/api/productos/${encodeURIComponent(det.codigo_barras.trim())}`
          : null;
      if (!url) return null;
      const res = await fetch(url);
      const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
      if (!res.ok || !json.data) return null;
      const p = json.data;
      return {
        cajas: p.stock_cajas ?? 0,
        unidades: p.stock_unidades ?? 0,
        unidades_por_caja: p.unidades_por_caja,
        producto: p,
      };
    } catch {
      return null;
    }
  }

  function aplicarStockLiveALinea(
    detalleId: string,
    live: { cajas: number; unidades: number }
  ) {
    if (sistEditadoManualRef.current.has(detalleId)) return;

    const base = baselinesRef.current[detalleId];
    const edit = editsRef.current[detalleId];
    if (!base || !edit) return;

    if (
      parseCantidad(edit.sistCajas) !== base.sistCajas ||
      parseCantidad(edit.sistUnidades) !== base.sistUnidades
    ) {
      sistEditadoManualRef.current.add(detalleId);
      return;
    }

    // Ya coincide con live: nada que hacer.
    if (base.sistCajas === live.cajas && base.sistUnidades === live.unidades) return;

    const nextBase: LineaBaseline = {
      ...base,
      sistCajas: live.cajas,
      sistUnidades: live.unidades,
    };
    const nextEdit: LineaEdit = {
      ...edit,
      sistCajas: String(live.cajas),
      sistUnidades: String(live.unidades),
    };
    baselinesRef.current = { ...baselinesRef.current, [detalleId]: nextBase };
    editsRef.current = { ...editsRef.current, [detalleId]: nextEdit };
    setBaselines(baselinesRef.current);
    setEdits(editsRef.current);
  }

  function asegurarFichaProducto(bc: string | null | undefined) {
    const codigo = String(bc ?? '').trim();
    if (!codigo) return;
    if (fichasSolicitadasRef.current.has(codigo)) return;
    if (productosPorBarcode[codigo] !== undefined) return;

    // Droguería: no hace falta fraccionable para editar diferencias.
    if (control?.es_drogueria) {
      fichasSolicitadasRef.current.add(codigo);
      setProductosPorBarcode((prev) =>
        prev[codigo] !== undefined ? prev : { ...prev, [codigo]: null }
      );
      return;
    }

    fichasSolicitadasRef.current.add(codigo);
    void (async () => {
      const data = await fetchFichaBasica(codigo);
      setProductosPorBarcode((prev) =>
        prev[codigo] !== undefined ? prev : { ...prev, [codigo]: data }
      );
    })();
  }

  function asegurarStockLive(
    det: Pick<ControlInventarioDetalle, 'producto_id_sistema' | 'codigo_barras'>,
    options?: { reintentarSiFallo?: boolean }
  ) {
    const clave = claveStockLive(det);
    if (!clave) return;

    const cacheado = stockLivePorProductoId[clave];
    // Éxito previo: no volver a pedir.
    if (cacheado != null) return;

    // Fallo previo: al reabrir la línea, limpiar y reintentar.
    if (cacheado === null) {
      if (!options?.reintentarSiFallo) return;
      stockLiveSolicitadoRef.current.delete(clave);
      setStockLivePorProductoId((prev) => {
        if (!(clave in prev)) return prev;
        const next = { ...prev };
        delete next[clave];
        return next;
      });
    } else if (stockLiveSolicitadoRef.current.has(clave)) {
      // Consulta en curso.
      return;
    }

    if (stockLiveSolicitadoRef.current.has(clave)) return;
    stockLiveSolicitadoRef.current.add(clave);
    void (async () => {
      const live = await fetchStockLive(det);
      if (!live) {
        setStockLivePorProductoId((prev) => ({ ...prev, [clave]: null }));
        stockLiveSolicitadoRef.current.delete(clave);
        return;
      }

      setStockLivePorProductoId((prev) => ({
        ...prev,
        [clave]: {
          cajas: live.cajas,
          unidades: live.unidades,
          unidades_por_caja: live.unidades_por_caja,
        },
      }));

      const bc = String(det.codigo_barras ?? '').trim();
      if (live.producto && bc) {
        setProductosPorBarcode((prev) => {
          const actual = prev[bc];
          if (actual === undefined) return prev;
          return {
            ...prev,
            [bc]: {
              ...(actual ?? live.producto!),
              ...live.producto!,
              fraccionable: actual?.fraccionable ?? live.producto!.fraccionable,
            },
          };
        });
      }
    })();
  }

  const detallesConDiferencias = useMemo(() => {
    const todos = control?.controles_inventario_detalle ?? [];
    return todos
      .filter((d) => {
        // Prioridad 1: flags persistidas en BD (más confiables para auditoría/históricos).
        const row = d as unknown as {
          con_diferencias?: number | boolean | string | null;
          estado?: string | null;
        };
        const conDif = Number(row.con_diferencias ?? 0) === 1 || row.con_diferencias === true;
        if (conDif) return true;
        const estadoNorm = String(row.estado ?? '')
          .toLowerCase()
          .replace(/[_\s]+/g, ' ')
          .trim();
        if (estadoNorm === 'con diferencia') return true;
        if (estadoNorm === 'sin diferencia' || estadoNorm === 'sin diferencias') return false;

        const sistC = d.stock_sist_cajas;
        const sistU = d.stock_sist_unidades;
        const realC = d.stock_real_cajas;
        const realU = d.stock_real_unidades;

        // Caso ideal: tenemos ambos lados de cada dimensión y comparamos por cajas/unidades.
        if (
          sistC != null &&
          sistU != null &&
          realC != null &&
          realU != null
        ) {
          return realC - sistC !== 0 || realU - sistU !== 0;
        }

        // Fallback final: diferencia total.
        return (d.diferencia ?? 0) !== 0;
      })
      .sort((a, b) => {
        const aVerificado = a.verificado === 1 ? 1 : 0;
        const bVerificado = b.verificado === 1 ? 1 : 0;
        if (aVerificado !== bVerificado) {
          // verificados al final
          return aVerificado - bVerificado;
        }
        return new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime();
      });
  }, [control]);

  // Precargar fichas de productos con diferencia (rápido). Stock live al abrir línea.
  useEffect(() => {
    const barcodes = Array.from(
      new Set(
        detallesConDiferencias
          .map((d) => String(d.codigo_barras ?? '').trim())
          .filter((bc) => bc.length > 0)
      )
    );
    for (const bc of barcodes) {
      asegurarFichaProducto(bc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga por barcodes derivados; evita loops con el map
  }, [detallesConDiferencias]);

  const detalleSeleccionado =
    detallesConDiferencias.find((d) => d.id === detalleSeleccionadoId) ?? null;

  function abrirDetalle(det: ControlInventarioDetalle) {
    sistEditadoManualRef.current.delete(det.id);
    asegurarFichaProducto(det.codigo_barras);

    const clave = claveStockLive(det);
    const livePrev = clave ? stockLivePorProductoId[clave] : undefined;
    const reintentarSiFallo = livePrev === null;
    // Si el intento anterior falló, al reabrir se vuelve a consultar.
    asegurarStockLive(det, { reintentarSiFallo });

    // Con reintento, no usar el null fallido: partir del snapshot del inventario.
    const live = reintentarSiFallo ? undefined : livePrev;
    const sistInicialC = live?.cajas ?? det.stock_sist_cajas ?? 0;
    const sistInicialU = live?.unidades ?? det.stock_sist_unidades ?? 0;

    const nextBase: LineaBaseline = {
      sistCajas: sistInicialC,
      sistUnidades: sistInicialU,
      realCajas: det.stock_real_cajas ?? 0,
      realUnidades: det.stock_real_unidades ?? 0,
    };
    const nextEdit: LineaEdit = {
      sistCajas: String(sistInicialC),
      sistUnidades: String(sistInicialU),
      realCajas: det.stock_real_cajas != null ? String(det.stock_real_cajas) : '',
      realUnidades:
        det.stock_real_unidades != null ? String(det.stock_real_unidades) : '',
    };
    baselinesRef.current = { ...baselinesRef.current, [det.id]: nextBase };
    editsRef.current = { ...editsRef.current, [det.id]: nextEdit };
    setBaselines(baselinesRef.current);
    setEdits(editsRef.current);
    setDetalleSeleccionadoId(det.id);
  }

  function marcarSistEditadoManual(detalleId: string) {
    sistEditadoManualRef.current.add(detalleId);
  }

  // Cuando llega el stock live, rellenar stock sistema si el usuario no lo tocó.
  useEffect(() => {
    if (!detalleSeleccionadoId) return;
    const det = detallesConDiferencias.find((d) => d.id === detalleSeleccionadoId);
    if (!det) return;
    const clave = claveStockLive(det);
    if (!clave) return;
    const live = stockLivePorProductoId[clave];
    if (!live) return;
    aplicarStockLiveALinea(detalleSeleccionadoId, live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockLivePorProductoId, detalleSeleccionadoId, detallesConDiferencias]);

  async function handleGuardarLinea(detalle: ControlInventarioDetalle) {
    const current = edits[detalle.id];
    const baseline = baselines[detalle.id];
    if (!current || !baseline) {
      notify.warning('Abrí la línea nuevamente antes de guardar.');
      return;
    }

    const esDrogueria = Boolean(control?.es_drogueria);
    const sistCajasNum = parseCantidad(current.sistCajas);
    const sistUnidadesNum = esDrogueria ? 0 : parseCantidad(current.sistUnidades);
    const realCajasNum = parseCantidad(current.realCajas);
    const realUnidadesNum = esDrogueria ? 0 : parseCantidad(current.realUnidades);

    if (
      [sistCajasNum, realCajasNum, ...(esDrogueria ? [] : [sistUnidadesNum, realUnidadesNum])].some(
        (n) => !esCantidadStockValida(n)
      )
    ) {
      notify.warning(mensajeCantidadStockInvalida());
      return;
    }
    if (realCajasNum > MAX_STOCK_REAL_CAJAS) {
      notify.warning(mensajeMaxStockRealCajas());
      return;
    }
    if (!esDrogueria && realUnidadesNum > MAX_STOCK_REAL_UNIDADES) {
      notify.warning(mensajeMaxStockRealUnidades());
      return;
    }

    const prod = detalle.codigo_barras ? productosPorBarcode[detalle.codigo_barras] : undefined;
    if (detalle.codigo_barras?.trim() && prod === undefined) {
      notify.warning('Esperá a que cargue la información del producto antes de guardar.');
      return;
    }
    const bcGuardar = claveStockLive(detalle);
    if (bcGuardar && !(bcGuardar in stockLivePorProductoId)) {
      notify.warning('Esperá a que termine la consulta del stock antes de guardar.');
      return;
    }

    const bloquearUnidades =
      esDrogueria ||
      debeBloquearUnidadesStockReal(
        detalle.codigo_barras,
        prod,
        baseline.sistUnidades
      );
    const sistUnidadesFinal = esDrogueria
      ? 0
      : bloquearUnidades
        ? baseline.sistUnidades
        : sistUnidadesNum;
    const realUnidadesFinal = esDrogueria
      ? 0
      : bloquearUnidades
        ? baseline.realUnidades
        : realUnidadesNum;

    const cambioSist =
      sistCajasNum !== baseline.sistCajas || sistUnidadesFinal !== baseline.sistUnidades;
    const cambioReal =
      realCajasNum !== baseline.realCajas || realUnidadesFinal !== baseline.realUnidades;

    if (!cambioSist && !cambioReal) {
      notify.info('No hay cambios para guardar.');
      return;
    }

    if (cambioSist) {
      const ok = await notify.confirm({
        title: 'Stock de sistema modificado',
        message:
          'Modificaste el stock de sistema (referencia del inventario en Plex), no el stock real contado.\n\n' +
          'El stock real es lo que se contó en góndola; el de sistema es lo que figura en el sistema.\n\n' +
          '¿Querés guardar igualmente?',
        confirmLabel: 'Guardar igual',
        cancelLabel: 'Cancelar',
        variant: 'warning',
      });
      if (!ok) return;
    }

    const unidadesPorCaja = inferirUnidadesPorCaja(
      detalle,
      sistCajasNum,
      sistUnidadesFinal,
      prod
    );
    const stockSistema = sistCajasNum * unidadesPorCaja + sistUnidadesFinal;
    const stockReal = realCajasNum * unidadesPorCaja + realUnidadesFinal;

    setGuardando(true);
    try {
      const res = await fetch(`/api/inventario/${id}/detalles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detalle_id: detalle.id,
          stock_sist_cajas: sistCajasNum,
          stock_sist_unidades: sistUnidadesFinal,
          stock_real_cajas: realCajasNum,
          stock_real_unidades: realUnidadesFinal,
          stock_real: stockReal,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        notify.error(json.error ?? 'Error al guardar la corrección');
        return;
      }

      // Refrescar control
      const recarga = await fetch(`/api/inventario/${id}`);
      const recargaJson = (await recarga.json()) as {
        data?: ControlConDetalles;
        error?: string;
      };
      if (!recarga.ok) {
        setError(recargaJson.error ?? 'Error al recargar control');
        return;
      }
      setControl(recargaJson.data!);
      setDetalleSeleccionadoId(null);
      notify.success('Corrección guardada');
    } catch {
      notify.error('Error al guardar la corrección');
    } finally {
      setGuardando(false);
    }
  }

  async function handleCerrarDefinitivo() {
    if (
      detallesConDiferencias.length > 0 &&
      !(await notify.confirm({
        title: 'Cerrar control',
        message: '¿Cerrar control con estas diferencias?',
        confirmLabel: 'Cerrar control',
        cancelLabel: 'Cancelar',
        variant: 'warning',
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/inventario/${id}/cerrar`, {
        method: 'POST',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        notify.error(json.error ?? 'Error al cerrar el control');
        return;
      }
      router.push('/dashboard');
    } catch {
      notify.error('Error al cerrar el control');
    }
  }

  if (loading) return <PageSpinner />;
  if (error || !control)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-700">
          {error || 'Control no encontrado'}
        </p>
        <Link href="/dashboard">
          <Button variant="outline" className="mt-4">
            Volver al dashboard
          </Button>
        </Link>
      </div>
    );

  const enProgreso = control.estado === 'en_progreso';
  const esAuditoria = esTipoAuditoria(inferirTipoControlInventario(control));

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => router.push(`/inventario/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Revisar diferencias
              </h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin &&
                ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
          </div>
        </div>

        {enProgreso && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleCerrarDefinitivo}
            className="shrink-0 gap-1"
            disabled={guardando}
          >
            <CheckCircle2 className="h-4 w-4" />
            Cerrar control
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Líneas con diferencias
            </h2>
            <Badge variant="info">
              {detallesConDiferencias.length} ítem
              {detallesConDiferencias.length !== 1 ? 's' : ''} con diferencia
              {detallesConDiferencias.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detallesConDiferencias.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">
              No hay diferencias. Podés cerrar el control.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">
                      Producto
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                      Sist.
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                      Real
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                      {esAuditoria ? 'Dif. auditoría' : 'Dif.'}
                    </th>
                    {esAuditoria ? (
                      <th className="px-4 py-3 text-right font-medium text-gray-500">
                        Ajuste sucursal
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detallesConDiferencias.map((det) => {
                    const sistCajas = det.stock_sist_cajas ?? 0;
                    const sistUnidades =
                      det.stock_sist_unidades ?? 0;
                    const row = det as unknown as {
                      ajustado?: number | null;
                      estado?: string | null;
                    };
                    const yaAjustado =
                      row.ajustado === 1 ||
                      row.estado === 'ajustado_sucursal' ||
                      row.estado === 'ajustado_auditoria';
                    const realCajas = det.stock_real_cajas ?? 0;
                    const realUnidades =
                      det.stock_real_unidades ?? 0;
                    const diffCajas = realCajas - sistCajas;
                    const diffUnidades =
                      realUnidades - sistUnidades;
                    const difSucCajas = det.diferencia_sucursal_cajas;
                    const difSucUnidades = det.diferencia_sucursal_unidades;
                    const ajusteInverso =
                      esAuditoria &&
                      esAjusteSucursalInversoAuditoria(
                        diffCajas,
                        diffUnidades,
                        difSucCajas,
                        difSucUnidades
                      );
                    const isSelected = detalleSeleccionadoId === det.id;

                    return (
                      <tr
                        key={det.id}
                        className={`cursor-pointer ${
                          ajusteInverso
                            ? 'bg-violet-50 hover:bg-violet-100/80 dark:bg-violet-950/35 dark:hover:bg-violet-950/50'
                            : yaAjustado
                              ? 'bg-gray-50 hover:bg-gray-50 dark:bg-gray-900/25 opacity-80'
                              : det.verificado === 1
                                ? 'bg-blue-50 hover:bg-gray-50 dark:bg-blue-950/35'
                                : 'bg-red-50 hover:bg-gray-50 dark:bg-red-950/35'
                        } ${isSelected ? 'ring-2 ring-blue-300' : ''}`}
                        onClick={() => {
                          if (yaAjustado) return;
                          abrirDetalle(det);
                        }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">
                            {det.descripcion}
                          </p>
                          <p className="text-base text-gray-900">
                            {det.presentacion}
                            {det.laboratorio ? ` · ${det.laboratorio}` : ''}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-700">
                            {det.codigo_barras ?? 'Sin código de barras'}
                          </p>
                          {control?.es_drogueria ? (
                            <p className="mt-0.5 text-sm font-medium text-blue-800">
                              {formatearUbicacionDrogueria({
                                sector: det.sector ?? null,
                                modulo: det.modulo ?? null,
                                fila: det.fila ?? null,
                                posicion: det.posicion ?? null,
                              })}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{det.stock_sist_cajas == null ? '-' : sistCajas}</span>
                            {!control?.es_drogueria ? (
                              <>
                                <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                                <span>{det.stock_sist_unidades == null ? '-' : sistUnidades}</span>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{det.stock_real_cajas == null ? '-' : realCajas}</span>
                            {!control?.es_drogueria ? (
                              <>
                                <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                                <span>{det.stock_real_unidades == null ? '-' : realUnidades}</span>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${
                              diffCajas === 0 ? 'text-gray-500'
                              : diffCajas > 0 ? 'text-blue-600'
                              : 'text-red-600'
                            }`}>
                              {diffCajas > 0 ? <TrendingUp className="h-3 w-3" /> : diffCajas < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {diffCajas > 0 ? '+' : ''}{diffCajas}
                            </span>
                            {!control?.es_drogueria ? (
                              <span className={`inline-flex items-center gap-0.5 font-semibold ${
                                diffUnidades === 0 ? 'text-gray-500'
                                : diffUnidades > 0 ? 'text-blue-600'
                                : 'text-red-600'
                              }`}>
                                {diffUnidades > 0 ? <TrendingUp className="h-3 w-3" /> : diffUnidades < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                                {diffUnidades > 0 ? '+' : ''}{diffUnidades}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {esAuditoria ? (
                          <td className="px-4 py-3 text-right text-gray-700">
                            <CeldaDiferenciaCajasUnidades
                              diffCajas={difSucCajas}
                              diffUnidades={difSucUnidades}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {detalleSeleccionado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDetalleSeleccionadoId(null)}
        >
          <div
            className="w-full max-w-4xl rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">
                  {detalleSeleccionado.descripcion}
                </p>
                <p className="text-sm text-gray-700">
                  {detalleSeleccionado.presentacion}{' '}
                  {detalleSeleccionado.laboratorio
                    ? `· ${detalleSeleccionado.laboratorio}`
                    : ''}
                </p>
                <p className="text-sm text-gray-700 mt-0.5">
                  {detalleSeleccionado.codigo_barras}
                </p>
                {control?.es_drogueria ? (
                  <p className="text-sm font-medium text-blue-800 mt-0.5">
                    {formatearUbicacionDrogueria({
                      sector: detalleSeleccionado.sector ?? null,
                      modulo: detalleSeleccionado.modulo ?? null,
                      fila: detalleSeleccionado.fila ?? null,
                      posicion: detalleSeleccionado.posicion ?? null,
                    })}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDetalleSeleccionadoId(null)}
              >
                Cerrar
              </Button>
            </div>

            {(() => {
              const det = detalleSeleccionado;
              const edit = edits[det.id];
              if (!edit) return null;
              const baseline = baselines[det.id];
              const prod = det.codigo_barras ? productosPorBarcode[det.codigo_barras] : undefined;
              const sistCajas = parseCantidad(edit.sistCajas);
              const sistUnidades = parseCantidad(edit.sistUnidades);
              const realCajas = parseCantidad(edit.realCajas);
              const realUnidades = parseCantidad(edit.realUnidades);
              const noPermitirUnidades =
                Boolean(control?.es_drogueria) ||
                debeBloquearUnidadesStockReal(
                  det.codigo_barras,
                  prod,
                  baseline?.sistUnidades ?? det.stock_sist_unidades
                );
              const efectivoSistUnidades = control?.es_drogueria
                ? 0
                : noPermitirUnidades
                  ? baseline?.sistUnidades ?? sistUnidades
                  : sistUnidades;
              const efectivoRealUnidades = control?.es_drogueria
                ? 0
                : noPermitirUnidades
                  ? baseline?.realUnidades ?? realUnidades
                  : realUnidades;
              const diffCajas = realCajas - sistCajas;
              const diffUnidades = efectivoRealUnidades - efectivoSistUnidades;
              const difSucCajas = det.diferencia_sucursal_cajas;
              const difSucUnidades = det.diferencia_sucursal_unidades;
              const cambioSist =
                baseline &&
                (sistCajas !== baseline.sistCajas ||
                  efectivoSistUnidades !== baseline.sistUnidades);
              const cargandoProd =
                !!det.codigo_barras?.trim() && prod === undefined;
              const claveLive = claveStockLive(det);
              const stockLive = claveLive ? stockLivePorProductoId[claveLive] : undefined;
              const consultandoPlex = !!claveLive && !(claveLive in stockLivePorProductoId);
              const stockLiveFallido =
                !!claveLive && claveLive in stockLivePorProductoId && stockLive === null;
              const bloqueandoGuardar = cargandoProd || consultandoPlex;
              return (
                <>
                  {cambioSist && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Estás modificando el <strong>stock de sistema</strong> (referencia en Plex), no el
                      stock real contado en el inventario.
                    </div>
                  )}
                  {consultandoPlex && (
                    <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      Consultando stock de Plex…
                    </div>
                  )}
                  {stockLiveFallido && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      No se pudo consultar el stock. Se muestran los valores del inventario; podés
                      editar y guardar.
                    </div>
                  )}
                <div className={`grid grid-cols-1 gap-3 ${esAuditoria ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                      Stock sistema
                      {stockLive ? (
                        <span className="ml-1 normal-case tracking-normal text-sky-700">
                          (Plex)
                        </span>
                      ) : null}
                    </p>
                    <div className="grid grid-cols-[92px_1fr] gap-y-2">
                      <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Cajas</span>
                      <Input
                        type="number"
                        step="1"
                        value={edit.sistCajas}
                        onChange={(e) => {
                          marcarSistEditadoManual(det.id);
                          setEdits((prev) => ({
                            ...prev,
                            [det.id]: { ...edit, sistCajas: e.target.value },
                          }));
                        }}
                        className="h-9 w-full text-center text-sm"
                        placeholder="Cajas"
                      />
                      {!control?.es_drogueria ? (
                        <>
                          <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Unidades</span>
                          <Input
                            type="number"
                            step="1"
                            value={
                              noPermitirUnidades
                                ? String(baseline?.sistUnidades ?? edit.sistUnidades)
                                : edit.sistUnidades
                            }
                            onChange={(e) => {
                              if (noPermitirUnidades) return;
                              marcarSistEditadoManual(det.id);
                              setEdits((prev) => ({
                                ...prev,
                                [det.id]: { ...edit, sistUnidades: e.target.value },
                              }));
                            }}
                            className="h-9 w-full text-center text-sm"
                            placeholder="Unidades"
                            disabled={noPermitirUnidades}
                            title={
                              noPermitirUnidades
                                ? 'Producto no fraccionable: unidades de sistema no editables.'
                                : undefined
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Stock real</p>
                    <div className="grid grid-cols-[92px_1fr] gap-y-2">
                      <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Cajas</span>
                      <Input
                        type="number"
                        step="1"
                        value={edit.realCajas}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [det.id]: { ...edit, realCajas: e.target.value },
                          }))
                        }
                        className="h-9 w-full text-center text-sm"
                        placeholder="Cajas"
                      />
                      {!control?.es_drogueria ? (
                        <>
                          <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Unidades</span>
                          <Input
                            type="number"
                            step="1"
                            value={
                              noPermitirUnidades
                                ? String(baseline?.realUnidades ?? edit.realUnidades)
                                : edit.realUnidades
                            }
                            onChange={(e) =>
                              !noPermitirUnidades &&
                              setEdits((prev) => ({
                                ...prev,
                                [det.id]: { ...edit, realUnidades: e.target.value },
                              }))
                            }
                            className="h-9 w-full text-center text-sm"
                            placeholder="Unidades"
                            disabled={noPermitirUnidades}
                            title={
                              cargandoProd
                                ? 'Cargando datos del producto…'
                                : noPermitirUnidades
                                  ? 'Producto no fraccionable o sin dato: solo podés corregir cajas.'
                                  : undefined
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Diferencia auditoría</p>
                    <div className="grid grid-cols-[92px_1fr] gap-y-2 text-xs">
                      <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Cajas</span>
                      <span className={`h-9 flex items-center justify-center font-semibold tabular-nums ${
                        diffCajas === 0 ? 'text-gray-700' : diffCajas > 0 ? 'text-blue-700' : 'text-red-700'
                      }`}>
                        {diffCajas > 0 ? '+' : ''}
                        {diffCajas.toFixed(0)}
                      </span>
                      {!control?.es_drogueria ? (
                        <>
                          <span className="h-9 flex items-center text-xs uppercase tracking-wide text-gray-500">Unidades</span>
                          <span className={`h-9 flex items-center justify-center font-semibold tabular-nums ${
                            diffUnidades === 0 ? 'text-gray-700' : diffUnidades > 0 ? 'text-blue-700' : 'text-red-700'
                          }`}>
                            {diffUnidades > 0 ? '+' : ''}
                            {diffUnidades.toFixed(0)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {esAuditoria ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                      <p className="text-xs uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">
                        Ajuste sucursal
                      </p>
                      <div className="grid grid-cols-[92px_1fr] gap-y-2 text-xs">
                        <span className="h-9 flex items-center text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">Cajas</span>
                        <span className="h-9 flex items-center justify-center font-semibold tabular-nums text-amber-900 dark:text-amber-100">
                          {difSucCajas == null ? '—' : `${difSucCajas > 0 ? '+' : ''}${difSucCajas}`}
                        </span>
                        {!control?.es_drogueria ? (
                          <>
                            <span className="h-9 flex items-center text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">Unidades</span>
                            <span className="h-9 flex items-center justify-center font-semibold tabular-nums text-amber-900 dark:text-amber-100">
                              {difSucUnidades == null ? '—' : `${difSucUnidades > 0 ? '+' : ''}${difSucUnidades}`}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleGuardarLinea(det)}
                      loading={guardando || consultandoPlex}
                      disabled={bloqueandoGuardar}
                      className="w-full"
                      title={
                        consultandoPlex
                          ? 'Esperá a que termine la consulta de stock'
                          : undefined
                      }
                    >
                      {consultandoPlex ? 'Consultando stock…' : 'Guardar cambios'}
                    </Button>
                  </div>
                </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

