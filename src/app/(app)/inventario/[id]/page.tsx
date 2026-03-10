'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Trash2, Package, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import type { ControlInventario, ControlInventarioDetalle, ProductoLegacy } from '@/types';

interface ControlConDetalles extends ControlInventario {
  controles_inventario_detalle: ControlInventarioDetalle[];
}

export default function InventarioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [control, setControl] = useState<ControlConDetalles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Estado del producto escaneado
  const [productoEscaneado, setProductoEscaneado] = useState<ProductoLegacy | null>(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [errorProducto, setErrorProducto] = useState('');
  const [stockRealCajas, setStockRealCajas] = useState('');
  const [stockRealUnidades, setStockRealUnidades] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Cerrar control
  const [cerrando, setCerrando] = useState(false);
  const [confirmCerrar, setConfirmCerrar] = useState(false);

  const cargarControl = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventario/${id}`);
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
    setStockRealCajas('');
    setStockRealUnidades('');
    setBuscandoProducto(true);

    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`);
      const json = await res.json() as { data?: ProductoLegacy; error?: string };
      if (!res.ok) {
        setErrorProducto(json.error ?? 'Producto no encontrado');
        return;
      }
      setProductoEscaneado(json.data!);
    } catch {
      setErrorProducto('Error al buscar el producto');
    } finally {
      setBuscandoProducto(false);
    }
  }

  async function handleGuardarLinea() {
    if (!productoEscaneado) return;
    const cajasNum =
      stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
    const unidadesNum =
      stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);

    if (isNaN(cajasNum) || cajasNum < 0) {
      setErrorProducto('Ingresá una cantidad válida de cajas (>= 0)');
      return;
    }
    if (isNaN(unidadesNum) || unidadesNum < 0) {
      setErrorProducto('Ingresá una cantidad válida de unidades (>= 0)');
      return;
    }

    // Si tenemos unidades_por_caja desde el backend, podríamos usarla; por ahora asumimos 1 unidad por caja.
    const unidadesPorCaja = productoEscaneado.unidades_por_caja && !isNaN(productoEscaneado.unidades_por_caja)
      ? productoEscaneado.unidades_por_caja
      : 1;
    const totalUnidades = cajasNum * unidadesPorCaja + unidadesNum;

    setGuardando(true);
    try {
      const res = await fetch(`/api/inventario/${id}/detalles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto_id_sistema: productoEscaneado.producto_id_sistema,
          codigo_barras: productoEscaneado.codigo_barras,
          descripcion: productoEscaneado.descripcion,
          presentacion: productoEscaneado.presentacion,
          laboratorio: productoEscaneado.laboratorio,
          stock_sistema: productoEscaneado.stock_sistema,
          stock_sist_cajas: productoEscaneado.stock_cajas ?? undefined,
          stock_sist_unidades: productoEscaneado.stock_unidades ?? undefined,
          stock_real_cajas: cajasNum || undefined,
          stock_real_unidades: unidadesNum || undefined,
          stock_real: totalUnidades,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setErrorProducto(json.error ?? 'Error al guardar'); return; }

      setProductoEscaneado(null);
      setStockRealCajas('');
      setStockRealUnidades('');
      await cargarControl();
    } catch {
      setErrorProducto('Error al guardar la línea');
    } finally {
      setGuardando(false);
    }
  }

  async function handleEliminarLinea(detalleId: string) {
    if (!confirm('¿Eliminar esta línea?')) return;
    await fetch(`/api/inventario/${id}/detalles?detalle_id=${detalleId}`, { method: 'DELETE' });
    await cargarControl();
  }

  async function handleCerrar() {
    setCerrando(true);
    try {
      const res = await fetch(`/api/inventario/${id}/cerrar`, { method: 'POST' });
      if (res.ok) { router.push('/dashboard'); }
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
  const detalles = control.controles_inventario_detalle ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">Control de inventario</h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin && ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
            {control.descripcion && (
              <p className="text-xs text-gray-500 mt-0.5">Descripción: {control.descripcion}</p>
            )}
          </div>
        </div>

        {enProgreso && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmCerrar(true)}
            className="shrink-0 gap-1"
          >
            <CheckCircle2 className="h-4 w-4" />
            Cerrar control
          </Button>
        )}
      </div>

      {/* Scanner (solo si está en progreso) */}
      {enProgreso && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Escanear producto</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BarcodeScanner
              onScan={handleScan}
              // Mientras hay un producto cargado o se está guardando, desactivamos el escáner
              disabled={buscandoProducto || guardando || !!productoEscaneado}
              placeholder="Escanear o ingresar código de barras..."
              autoFocusInput={!productoEscaneado}
            />

            {buscandoProducto && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                Buscando producto...
              </div>
            )}

            {errorProducto && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {errorProducto}
              </div>
            )}

            {/* Ficha del producto escaneado */}
            {productoEscaneado && (
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="font-semibold text-gray-900 text-lg">{productoEscaneado.descripcion}</p>
                    <p className="text-sm text-gray-600">{productoEscaneado.presentacion} . {productoEscaneado.laboratorio}</p>
                    <p className="mt-2 font-mono text-base text-gray-800">
                      {productoEscaneado.codigo_barras}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-200">
                    <Package className="h-5 w-5 text-blue-700" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Columna izquierda: stock sistema (cajas/unidades) */}
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Stock sistema</p>
                    <div className="space-y-1">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Cajas</p>
                        <p className="text-2xl font-extrabold text-gray-900 leading-tight">
                          {productoEscaneado.stock_cajas ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Unidades</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight">
                          {productoEscaneado.stock_unidades ?? 0}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Columna derecha: stock real (inputs cajas/unidades) */}
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 space-y-2">
                    <Input
                      label="Stock real (cajas)"
                      type="number"
                      min="0"
                      step="1"
                      value={stockRealCajas}
                      onChange={e => setStockRealCajas(e.target.value)}
                      placeholder="0"
                      autoFocus
                      className="text-xl font-bold"
                    />
                    <Input
                      label="Stock real (unidades)"
                      type="number"
                      min="0"
                      step="1"
                      value={stockRealUnidades}
                      onChange={e => setStockRealUnidades(e.target.value)}
                      placeholder="0"
                      className="text-xl font-bold"
                    />
                  </div>
                </div>

                {productoEscaneado && (stockRealCajas !== '' || stockRealUnidades !== '') && (
                  <div
                    className={`mb-4 rounded-lg px-3 py-2 text-center ${
                      (() => {
                        const sistCajas = productoEscaneado.stock_cajas ?? 0;
                        const sistUnidades = productoEscaneado.stock_unidades ?? 0;
                        const cajasNum =
                          stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
                        const unidadesNum =
                          stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);
                        const diffCajas = cajasNum - sistCajas;
                        const diffUnidades = unidadesNum - sistUnidades;
                        if (diffCajas === 0 && diffUnidades === 0)
                          return 'bg-green-50 text-green-700';
                        if (diffCajas > 0 || diffUnidades > 0)
                          return 'bg-blue-50 text-blue-700';
                        return 'bg-red-50 text-red-700';
                      })()
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {(() => {
                        const sistCajas = productoEscaneado.stock_cajas ?? 0;
                        const sistUnidades = productoEscaneado.stock_unidades ?? 0;
                        const cajasNum =
                          stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
                        const unidadesNum =
                          stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);
                        const diffCajas = cajasNum - sistCajas;
                        const diffUnidades = unidadesNum - sistUnidades;
                        const signC = diffCajas > 0 ? '+' : diffCajas < 0 ? '' : '';
                        const signU = diffUnidades > 0 ? '+' : diffUnidades < 0 ? '' : '';
                        return `Dif. cajas: ${signC}${diffCajas.toFixed(
                          0
                        )} · Dif. unidades: ${signU}${diffUnidades.toFixed(0)}`;
                      })()}
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => {
                      setProductoEscaneado(null);
                      setStockRealCajas('');
                      setStockRealUnidades('');
                      setErrorProducto('');
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="md"
                    loading={guardando}
                    onClick={handleGuardarLinea}
                    disabled={stockRealCajas === '' && stockRealUnidades === ''}
                    className="flex-1"
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabla de productos registrados */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Productos registrados</h2>
            <Badge variant="info">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</Badge>
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
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Sist.</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Real</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Dif.</th>
                    {enProgreso && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalles.map(det => {
                    const dif = det.diferencia;
                    const sistCajas = det.stock_sist_cajas ?? 0;
                    const sistUnidades = det.stock_sist_unidades ?? 0;
                    const realCajas = det.stock_real_cajas ?? 0;
                    const realUnidades = det.stock_real_unidades ?? 0;
                    const difCajas = realCajas - sistCajas;
                    const difUnidades = realUnidades - sistUnidades;
                    return (
                      <tr key={det.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{det.descripcion}</p>
                          <p className="text-xs text-gray-400">{det.presentacion} · {det.laboratorio}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{sistCajas}</span>
                            <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                            <span>{sistUnidades}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{realCajas}</span>
                            <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                            <span>{realUnidades}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${
                              difCajas === 0 ? 'text-gray-500'
                              : difCajas > 0 ? 'text-blue-600'
                              : 'text-red-600'
                            }`}>
                              {difCajas > 0 ? <TrendingUp className="h-3 w-3" /> : difCajas < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {difCajas > 0 ? '+' : ''}{difCajas}
                            </span>
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${
                              difUnidades === 0 ? 'text-gray-500'
                              : difUnidades > 0 ? 'text-blue-600'
                              : 'text-red-600'
                            }`}>
                              {difUnidades > 0 ? <TrendingUp className="h-3 w-3" /> : difUnidades < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {difUnidades > 0 ? '+' : ''}{difUnidades}
                            </span>
                          </div>
                        </td>
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
            <div className="flex gap-4 text-xs text-gray-500">
              <span className="text-blue-600 font-medium">+{detalles.filter(d => d.diferencia > 0).length} sobrantes</span>
              <span className="text-red-600 font-medium">{detalles.filter(d => d.diferencia < 0).length} faltantes</span>
              <span className="text-gray-400">{detalles.filter(d => d.diferencia === 0).length} sin diferencia</span>
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Modal de confirmación de cierre */}
      {confirmCerrar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">¿Cerrar control?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Una vez cerrado no podrás agregar más productos. Esta acción no se puede deshacer.
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
