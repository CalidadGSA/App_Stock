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

  const [cerrando, setCerrando] = useState(false);
  const [confirmCerrar, setConfirmCerrar] = useState(false);

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

  async function handleScan(barcode: string) {
    setErrorProducto('');
    setProductoEscaneado(null);
    setLotes([LOTE_VACIO]);
    setBuscandoProducto(true);

    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`);
      const json = await res.json() as { data?: ProductoLegacy; error?: string };
      if (!res.ok) { setErrorProducto(json.error ?? 'Producto no encontrado'); return; }
      setProductoEscaneado(json.data!);
    } catch {
      setErrorProducto('Error al buscar el producto');
    } finally {
      setBuscandoProducto(false);
    }
  }

  function agregarLote() {
    setLotes(prev => [...prev, LOTE_VACIO]);
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

    setGuardando(true);
    try {
      for (const lote of lotesValidos) {
        const res = await fetch(`/api/vencimientos/${id}/detalles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto_id_sistema: productoEscaneado.producto_id_sistema,
            codigo_barras: productoEscaneado.codigo_barras,
            descripcion: productoEscaneado.descripcion,
            presentacion: productoEscaneado.presentacion,
            laboratorio: productoEscaneado.laboratorio,
            fecha_vencimiento: lote.fecha_vencimiento,
            cantidad: parseFloat(lote.cantidad),
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) { setErrorProducto(json.error ?? 'Error al guardar'); return; }
      }

      setProductoEscaneado(null);
      setLotes([LOTE_VACIO]);
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

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">Control de vencimientos</h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin && ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
            {control.observaciones && (
              <p className="text-xs text-gray-400 mt-0.5">Obs: {control.observaciones}</p>
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
            <h2 className="font-semibold text-gray-900">Escanear producto</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BarcodeScanner
              onScan={handleScan}
              // Mientras hay un producto cargado o se están guardando lotes, desactivamos el escáner
              disabled={buscandoProducto || guardando || !!productoEscaneado}
              placeholder="Escanear o ingresar código de barras..."
              autoFocusInput={!productoEscaneado}
            />

            {buscandoProducto && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                Buscando producto...
              </div>
            )}

            {errorProducto && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {errorProducto}
              </div>
            )}

            {/* Ficha del producto + formulario de lotes */}
            {productoEscaneado && (
              <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4 flex flex-col gap-4">
                {/* Info producto */}
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-200">
                    <Package className="h-5 w-5 text-indigo-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{productoEscaneado.descripcion}</p>
                    <p className="text-sm text-gray-600">{productoEscaneado.presentacion} · {productoEscaneado.laboratorio}</p>
                    <p className="text-xs font-mono text-gray-400">{productoEscaneado.codigo_barras}</p>
                  </div>
                </div>

                {/* Lotes */}
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                    <CalendarClock className="h-4 w-4 text-indigo-600" />
                    Fechas de vencimiento y cantidades
                  </p>

                  {lotes.map((lote, idx) => (
                    <div key={idx} className="flex items-end gap-2 rounded-xl bg-white border border-indigo-100 p-3">
                      <div className="flex-1">
                        <Input
                          label={`Lote ${idx + 1} – Fecha de vencimiento`}
                          type="date"
                          value={lote.fecha_vencimiento}
                          onChange={e => actualizarLote(idx, 'fecha_vencimiento', e.target.value)}
                          required
                        />
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
                          className="mb-0.5 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={agregarLote}
                    className="flex items-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 px-4 py-3 text-sm text-indigo-600 hover:bg-indigo-100 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar otra fecha de vencimiento
                  </button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => { setProductoEscaneado(null); setLotes([LOTE_VACIO]); setErrorProducto(''); }}
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
            <h2 className="font-semibold text-gray-900">Productos registrados</h2>
            <Badge variant="info">{detalles.length} registro{detalles.length !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detalles.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">
              No hay productos cargados aún. Empezá escaneando.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Producto</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500">Vencimiento</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Cantidad</th>
                    {enProgreso && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalles.map(det => {
                    const dias = diasHastaVencimiento(det.fecha_vencimiento);
                    const colorClass = colorVencimiento(dias);
                    return (
                      <tr key={det.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{det.descripcion}</p>
                          <p className="text-xs text-gray-400">{det.presentacion} · {det.laboratorio}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                            {dias < 0 ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                            {formatDate(det.fecha_vencimiento)}
                            {dias < 0 ? ' (vencido)' : ` (${dias}d)`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">{det.cantidad}</td>
                        {enProgreso && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleEliminarLinea(det.id)}
                              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
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
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">¿Cerrar control?</h3>
            <p className="text-sm text-gray-600 mb-6">
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
