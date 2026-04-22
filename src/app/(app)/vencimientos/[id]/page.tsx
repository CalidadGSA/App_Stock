'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, Trash2, Package, Plus, AlertTriangle, CalendarClock
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, formatDateTime, diasHastaVencimiento, colorVencimiento } from '@/lib/utils';
import type { ControlVencimiento, ControlVencimientoDetalle, ProductoLegacy } from '@/types';

interface ControlConDetalles extends ControlVencimiento {
  controles_vencimientos_detalle: ControlVencimientoDetalle[];
}

interface LoteForm {
  fecha_vencimiento: string;
  cantidad: string;
}

const LOTE_VACIO: LoteForm = { fecha_vencimiento: '', cantidad: '' };

function ymdToYm(ymd: string): string {
  const raw = (ymd ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[1]}-${m[2]}`;
}

function ymToLastDayYmd(ym: string): string | null {
  const raw = (ym ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export default function VencimientoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [control, setControl] = useState<ControlConDetalles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [productoEscaneado, setProductoEscaneado] = useState<ProductoLegacy | null>(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [errorProducto, setErrorProducto] = useState('');
  const [lotes, setLotes] = useState<LoteForm[]>([LOTE_VACIO]);
  const [guardando, setGuardando] = useState(false);
  // Cuando el usuario "edita" un producto ya cargado desde la tabla,
  // guardamos el producto_id_sistema para poder reemplazar sus lotes.
  const [editandoProductoId, setEditandoProductoId] = useState<string | null>(null);
  const [resultadosBusqueda, setResultadosBusqueda] = useState<
    {
      producto_id_sistema: string;
      codigo_barras: string | null;
      descripcion: string;
      presentacion: string | null;
      laboratorio: string | null;
    }[]
  >([]);

  const [cerrando, setCerrando] = useState(false);
  const [confirmCerrar, setConfirmCerrar] = useState(false);
  /** Misma fecha+producto ya cargada en otro control (misma sucursal). */
  const [duplicadosPorFecha, setDuplicadosPorFecha] = useState<Record<string, boolean>>({});

  const cargarControl = useCallback(async () => {
    try {
      const res = await fetch(`/api/vencimientos/${id}`);
      const json = await res.json() as { data?: ControlConDetalles; error?: string };
      if (!res.ok) { setError(json.error ?? 'Error al cargar'); return; }
      setControl(json.data!);
    } catch {
      setError('Error al cargar el control');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargarControl(); }, [cargarControl]);

  useEffect(() => {
    if (!control?.id || control.estado !== 'en_progreso' || !productoEscaneado) {
      setDuplicadosPorFecha({});
      return;
    }
    const fechas = lotes.map((l) => (l.fecha_vencimiento ?? '').trim()).filter(Boolean);
    if (fechas.length === 0) {
      setDuplicadosPorFecha({});
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams({
          control_id: String(control.id),
          producto_id: productoEscaneado.producto_id_sistema,
          fechas: fechas
            .map((ym) => ymToLastDayYmd(ym))
            .filter((v): v is string => Boolean(v))
            .join(','),
        });
        try {
          const res = await fetch(`/api/vencimientos/duplicado-otro-control?${params.toString()}`);
          const json = (await res.json()) as {
            data?: { duplicados_por_fecha?: Record<string, boolean> };
          };
          if (res.ok && json.data?.duplicados_por_fecha) {
            setDuplicadosPorFecha(json.data.duplicados_por_fecha);
          } else {
            setDuplicadosPorFecha({});
          }
        } catch {
          setDuplicadosPorFecha({});
        }
      })();
    }, 450);
    return () => window.clearTimeout(handle);
  }, [control?.id, control?.estado, productoEscaneado?.producto_id_sistema, lotes]);

  async function handleScan(barcode: string): Promise<boolean> {
    setErrorProducto('');
    setDuplicadosPorFecha({});
    setProductoEscaneado(null);
    setLotes([LOTE_VACIO]);
    setEditandoProductoId(null);
    setResultadosBusqueda([]);

    const query = barcode.trim();
    if (!query) return false;

    // Si contiene letras, lo interpretamos como búsqueda por nombre (producto + presentación)
    if (/[a-zA-Z]/.test(query)) {
      setBuscandoProducto(true);
      try {
        const params = new URLSearchParams({ q: query });
        const res = await fetch(`/api/productos/buscar?${params.toString()}`);
        const json = await res.json() as {
          data?: {
            producto_id_sistema: string;
            codigo_barras: string | null;
            descripcion: string;
            presentacion: string | null;
            laboratorio: string | null;
          }[];
          error?: string;
        };
        if (!res.ok) {
          setErrorProducto(json.error ?? 'Error al buscar productos en medicamentos.');
          return false;
        }
        const lista = json.data ?? [];
        setResultadosBusqueda(lista);
        if (lista.length === 0) {
          setErrorProducto('No se encontraron productos para ese texto.');
          return false;
        }
        return true;
      } catch {
        setErrorProducto('Error al buscar productos en medicamentos.');
        return false;
      } finally {
        setBuscandoProducto(false);
      }
      
    }

    // Caso código de barras: usamos la versión básica sin stock.
    setBuscandoProducto(true);
    try {
      const res = await fetch(`/api/productos/basico/${encodeURIComponent(barcode)}`);
      const json = await res.json() as { data?: ProductoLegacy; error?: string };
      if (!res.ok) {
        setErrorProducto(json.error ?? 'Producto no encontrado');
        return false;
      }
      const producto = json.data!;
      const existente = detalles.find((d) => d.producto_id_sistema === producto.producto_id_sistema);
      if (existente) {
        handleEditarProductoDesdeLinea(existente);
      } else {
        setProductoEscaneado(producto);
      }
      return true;
    } catch {
      setErrorProducto('Error al buscar el producto');
      return false;
    } finally {
      setBuscandoProducto(false);
    }
  }

  function agregarLote() {
    // No permitir agregar infinitos lotes si hay alguno aún no completo (fecha y cantidad > 0).
    const hayIncompleto = lotes.some((l) => {
      const cantStr = (l.cantidad ?? '').toString().trim();
      const cantNum = parseFloat(cantStr);
      const completo = !!l.fecha_vencimiento && cantStr.length > 0 && !isNaN(cantNum) && cantNum > 0;
      return !completo;
    });

    if (hayIncompleto) {
      setErrorProducto('Completá el lote actual (fecha y cantidad) antes de agregar otro.');
      return;
    }

    setLotes((prev) => [...prev, LOTE_VACIO]);
  }

  function actualizarLote(idx: number, field: keyof LoteForm, value: string) {
    setLotes(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function eliminarLote(idx: number) {
    setLotes(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleGuardarLotes() {
    if (!productoEscaneado) return;

    // Cada lote debe tener fecha y cantidad > 0, sin huecos
    const hayIncompletos = lotes.some(l => {
      const tieneFecha = !!l.fecha_vencimiento;
      const cantNum = parseFloat(l.cantidad);
      const tieneCantidad = !isNaN(cantNum) && cantNum > 0;
      return (tieneFecha && !tieneCantidad) || (!tieneFecha && (l.cantidad || '').trim() !== '');
    });

    if (hayIncompletos) {
      setErrorProducto('Completá fecha y cantidad en todos los lotes o eliminá los que no uses.');
      return;
    }

    const lotesValidos = lotes.filter(l => {
      const cantNum = parseFloat(l.cantidad);
      return l.fecha_vencimiento && !isNaN(cantNum) && cantNum > 0;
    });

    if (lotesValidos.length === 0) {
      setErrorProducto('Ingresá al menos una fecha de vencimiento y cantidad válida.');
      return;
    }

    const hayDuplicadoOtroControl = lotesValidos.some((l) => {
      const fechaYmd = ymToLastDayYmd(l.fecha_vencimiento);
      return fechaYmd ? Boolean(duplicadosPorFecha[fechaYmd]) : false;
    });
    if (
      hayDuplicadoOtroControl &&
      !window.confirm(
        'Hay al menos una fecha que ya figura en otro control de vencimientos. ¿Cargar igual?'
      )
    ) {
      return;
    }

    setGuardando(true);
    try {
      // Si estamos editando un producto existente, primero eliminamos sus líneas
      // para evitar duplicados al confirmar.
      if (editandoProductoId) {
        const detalleIdsParaReemplazar = detalles
          .filter((d) => d.producto_id_sistema === editandoProductoId)
          .map((d) => d.id);

        for (const detalleId of detalleIdsParaReemplazar) {
          const delRes = await fetch(
            `/api/vencimientos/${id}/detalles?detalle_id=${encodeURIComponent(detalleId)}`,
            { method: 'DELETE' }
          );
          if (!delRes.ok) {
            const json = await delRes.json().catch(() => ({}));
            setErrorProducto(json.error ?? 'Error al reemplazar líneas');
            return;
          }
        }
      }

      for (const lote of lotesValidos) {
        const fechaYmd = ymToLastDayYmd(lote.fecha_vencimiento);
        if (!fechaYmd) {
          setErrorProducto('Mes de vencimiento inválido.');
          return;
        }
        const res = await fetch(`/api/vencimientos/${id}/detalles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto_id_sistema: productoEscaneado.producto_id_sistema,
            codigo_barras: productoEscaneado.codigo_barras,
            descripcion: productoEscaneado.descripcion,
            presentacion: productoEscaneado.presentacion,
            laboratorio: productoEscaneado.laboratorio,
            fecha_vencimiento: fechaYmd,
            cantidad: parseFloat(lote.cantidad),
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) { setErrorProducto(json.error ?? 'Error al guardar'); return; }
      }

      setProductoEscaneado(null);
      setLotes([LOTE_VACIO]);
      setEditandoProductoId(null);
      await cargarControl();
    } catch {
      setErrorProducto('Error al guardar los lotes');
    } finally {
      setGuardando(false);
    }
  }

  async function handleEliminarLinea(detalleId: string) {
    if (!confirm('¿Eliminar este registro?')) return;
    await fetch(`/api/vencimientos/${id}/detalles?detalle_id=${detalleId}`, { method: 'DELETE' });
    await cargarControl();
  }

  function handleEditarProductoDesdeLinea(detalle: ControlVencimientoDetalle) {
    setErrorProducto('');
    setBuscandoProducto(false);
    setResultadosBusqueda([]);

    const productoId = detalle.producto_id_sistema;
    const lotesDelProducto = detalles
      .filter((d) => d.producto_id_sistema === productoId)
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
      .map((d) => ({
        fecha_vencimiento: ymdToYm(d.fecha_vencimiento),
        cantidad: String(d.cantidad),
      }));

    setEditandoProductoId(productoId);
    setProductoEscaneado({
      producto_id_sistema: detalle.producto_id_sistema,
      codigo_barras: detalle.codigo_barras,
      codigos_secundarios: [],
      descripcion: detalle.descripcion,
      presentacion: detalle.presentacion,
      laboratorio: detalle.laboratorio,
      stock_sistema: 0,
      fraccionable: undefined,
    });

    // Volvemos a abrir la card con los lotes existentes del producto.
    // El lote vacío se agrega solo si el usuario presiona "Agregar otra fecha..."
    setLotes(lotesDelProducto);
  }

  async function handleCerrar() {
    setCerrando(true);
    try {
      const res = await fetch(`/api/vencimientos/${id}/cerrar`, { method: 'POST' });
      if (res.ok) router.push('/dashboard');
    } finally {
      setCerrando(false);
      setConfirmCerrar(false);
    }
  }

  if (loading) return <PageSpinner />;
  if (error || !control) return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-red-700">{error || 'Control no encontrado'}</p>
      <Link href="/dashboard"><Button variant="outline" className="mt-4">Volver al dashboard</Button></Link>
    </div>
  );

  const enProgreso = control.estado === 'en_progreso';
  const detalles = control.controles_vencimientos_detalle ?? [];
  const bloqueoAgregarLote = lotes.some((l) => {
    const cantStr = (l.cantidad ?? '').toString().trim();
    const cantNum = parseFloat(cantStr);
    const completo =
      !!l.fecha_vencimiento && cantStr.length > 0 && !isNaN(cantNum) && cantNum > 0;
    return !completo;
  });
  // Nombre completo del operador desde el join con operadores
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const operadorNombreCompleto =
    ((control as any).operadores?.nombrecompleto as string | undefined) ??
    ((control as any).operadores?.nombreCompleto as string | undefined) ??
    '';

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Control de vencimientos</h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
              {control.categoria_macro && (
                <Badge variant="default" className="border-gray-300 px-1.5 py-0 text-[10px] text-gray-700 dark:border-gray-700 dark:text-gray-200">
                  {control.categoria_macro}
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin && ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
            {operadorNombreCompleto && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Operador: {operadorNombreCompleto}
              </p>
            )}
            {control.observaciones && (
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">Obs: {control.observaciones}</p>
            )}
          </div>
        </div>
        {enProgreso && (
          <Button variant="danger" size="sm" onClick={() => setConfirmCerrar(true)} className="shrink-0 gap-1">
            <CheckCircle2 className="h-4 w-4" />
            Cerrar control
          </Button>
        )}
      </div>

      {/* Scanner */}
      {enProgreso && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Buscar producto</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BarcodeScanner
              onScan={handleScan}
              // Mientras hay un producto cargado o se están guardando lotes, desactivamos el escáner
              disabled={buscandoProducto || guardando || !!productoEscaneado}
              placeholder="Código de barras, troquel o nombre…"
              autoFocusInput={!productoEscaneado}
            />

            {buscandoProducto && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                Buscando producto...
              </div>
            )}

            {errorProducto && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {errorProducto}
              </div>
            )}

            {/* Resultados de búsqueda por nombre (producto + presentación) */}
            {resultadosBusqueda.length > 0 && !productoEscaneado && (
              <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-gray-800 dark:border-indigo-900/50 dark:bg-indigo-950/25 dark:text-gray-200">
                <p className="font-semibold">Resultados:</p>
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {resultadosBusqueda.map((r) => (
                    <li
                      key={`${r.producto_id_sistema}-${r.codigo_barras ?? 'sin-bc'}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 dark:bg-slate-900/70"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {r.descripcion}
                        </p>
                        <p className="truncate text-sm text-gray-900 dark:text-gray-200">
                          {r.presentacion} · {r.laboratorio}
                        </p>
                        <p className="font-mono text-sm text-gray-900 dark:text-gray-300">
                          {r.codigo_barras ?? 'Sin código de barras'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={buscandoProducto}
                        title="Cargar este producto"
                        onClick={() => {
                          void (async () => {
                            setErrorProducto('');
                            setBuscandoProducto(true);
                            try {
                              const res = await fetch(
                                `/api/productos/id/${encodeURIComponent(r.producto_id_sistema)}`
                              );
                              const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
                              if (!res.ok || !json.data) {
                                setErrorProducto(json.error ?? 'No se pudo cargar el producto');
                                return;
                              }
                              setResultadosBusqueda([]);
                              const producto = json.data;
                              const existente = detalles.find(
                                (d) => d.producto_id_sistema === producto.producto_id_sistema
                              );
                              if (existente) {
                                handleEditarProductoDesdeLinea(existente);
                              } else {
                                setProductoEscaneado(producto);
                              }
                            } catch {
                              setErrorProducto('Error al cargar el producto');
                            } finally {
                              setBuscandoProducto(false);
                            }
                          })();
                        }}
                      >
                        Usar
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Ficha del producto + formulario de lotes */}
            {productoEscaneado && (
              <div className="flex flex-col gap-4 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/25">
                {/* Info producto */}
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-200 dark:bg-indigo-900/50">
                    <Package className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{productoEscaneado.descripcion}</p>
                    <p className="text-base text-gray-900 dark:text-gray-200">{productoEscaneado.presentacion} · {productoEscaneado.laboratorio}</p>
                    <p className="text-sm font-mono text-gray-900 dark:text-gray-300">
                      {productoEscaneado.codigo_barras || 'Sin código'}
                      {(() => {
                        const tr = productoEscaneado.troquel;
                        if (tr == null || `${tr}`.trim() === '') return null;
                        const n = Number(tr);
                        if (Number.isFinite(n) && n === 0) return null;
                        return (
                          <>
                            {' '}
                            · Troquel {Number.isFinite(n) ? n : tr}
                          </>
                        );
                      })()}
                      {' '}
                      · ID {productoEscaneado.producto_id_sistema}
                    </p>
                    {Object.values(duplicadosPorFecha).some(Boolean) ? (
                      <p className="mt-2 rounded-md border border-amber-400 bg-amber-100/90 px-2 py-1 text-xs font-semibold text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
                        Producto duplicado, revisar
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Lotes */}
                <div className="flex flex-col gap-3">
                  <p className="flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                    <CalendarClock className="h-4 w-4 text-indigo-600" />
                    Fechas de vencimiento y cantidades
                  </p>

                  {lotes.map((lote, idx) => (
                    <div key={idx} className="flex items-end gap-2 rounded-xl border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-slate-900/70">
                      <div className="flex-1">
                        <Input
                          label={`Lote ${idx + 1} – Fecha de vencimiento`}
                          type="month"
                          value={lote.fecha_vencimiento}
                          onChange={e => actualizarLote(idx, 'fecha_vencimiento', e.target.value)}
                          required
                        />
                        {lote.fecha_vencimiento &&
                        (() => {
                          const fechaYmd = ymToLastDayYmd(lote.fecha_vencimiento);
                          return fechaYmd ? Boolean(duplicadosPorFecha[fechaYmd]) : false;
                        })() ? (
                          <p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                            Producto duplicado, revisar
                          </p>
                        ) : null}
                      </div>
                      <div className="w-28">
                        <Input
                          label="Cantidad"
                          type="number"
                          min="1"
                          step="1"
                          value={lote.cantidad}
                          onChange={e => actualizarLote(idx, 'cantidad', e.target.value)}
                          placeholder="0"
                          required
                        />
                      </div>
                      {lotes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => eliminarLote(idx)}
                          className="mb-0.5 rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={agregarLote}
                    disabled={bloqueoAgregarLote}
                    className={`flex items-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 px-4 py-3 text-sm text-indigo-600 transition-colors dark:border-indigo-700/70 dark:text-indigo-300 ${
                      bloqueoAgregarLote ? 'cursor-not-allowed opacity-50' : 'hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar otra fecha de vencimiento
                  </button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => {
                      setProductoEscaneado(null);
                      setLotes([LOTE_VACIO]);
                      setEditandoProductoId(null);
                      setErrorProducto('');
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="md"
                    loading={guardando}
                    onClick={handleGuardarLotes}
                    disabled={lotes.every(l => !l.fecha_vencimiento && (l.cantidad || '').trim() === '')}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabla de registros */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Productos registrados</h2>
            <Badge variant="info">{detalles.length} registro{detalles.length !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detalles.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
              No hay productos cargados aún. Empezá escaneando.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">Producto</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-300">Vencimiento</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-300">Cantidad</th>
                    {enProgreso && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {detalles.map(det => {
                    const dias = diasHastaVencimiento(det.fecha_vencimiento);
                    const colorClass = colorVencimiento(dias);
                    return (
                      <tr
                        key={det.id}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900/60"
                        onClick={() => {
                          if (!enProgreso) return;
                          handleEditarProductoDesdeLinea(det);
                        }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{det.descripcion}</p>
                          <p className="text-sm text-gray-900 dark:text-gray-200">{det.presentacion} · {det.laboratorio}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                            {dias < 0 ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                            {formatDate(det.fecha_vencimiento)}
                            {dias < 0 ? ' (vencido)' : ` (${dias}d)`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">{det.cantidad}</td>
                        {enProgreso && (
                          <td className="px-4 py-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleEliminarLinea(det.id);
                              }}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {detalles.length > 0 && (
          <CardFooter>
            <div className="flex gap-4 text-xs">
              <span className="text-red-600 font-medium">{detalles.filter(d => diasHastaVencimiento(d.fecha_vencimiento) < 0).length} vencidos</span>
              <span className="text-orange-600 font-medium">{detalles.filter(d => { const d_ = diasHastaVencimiento(d.fecha_vencimiento); return d_ >= 0 && d_ <= 30; }).length} vencen en 30d</span>
              <span className="text-yellow-600 font-medium">{detalles.filter(d => { const d_ = diasHastaVencimiento(d.fecha_vencimiento); return d_ > 30 && d_ <= 60; }).length} vencen en 31-60d</span>
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Modal confirmación de cierre */}
      {confirmCerrar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-slate-900">
            <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">¿Cerrar control?</h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-300">
              Una vez cerrado no podrás agregar más productos.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" onClick={() => setConfirmCerrar(false)} className="flex-1">
                Cancelar
              </Button>
              <Button variant="danger" size="lg" loading={cerrando} onClick={handleCerrar} className="flex-1">
                Cerrar control
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
