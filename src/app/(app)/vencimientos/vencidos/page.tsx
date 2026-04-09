'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, diasHastaVencimiento, colorVencimiento } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

interface VencidoItem {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  accion_observacion: string | null;
  cantidad_vendida_acumulada: number;
  cantidad_cargada_original: number;
  ratio_vendido_sobre_original: number | null;
  obligatorio_observacion_devolucion: boolean;
  venta_posterior_a_carga?: boolean;
}

function textoObservacionEfectiva(item: VencidoItem, obsLocal: Record<string, string>): string {
  if (obsLocal[item.id] !== undefined) return obsLocal[item.id];
  return item.accion_observacion ?? '';
}

export default function VencidosPage() {
  const router = useRouter();
  const [items, setItems] = useState<VencidoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [obsLocal, setObsLocal] = useState<Record<string, string>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  const itemsFiltrados = useMemo(() => {
    let res = items;
    if (categoriaFiltro) {
      res = res.filter((i) => i.categoria_macro === categoriaFiltro);
    }
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return res;
    return res.filter((i) => {
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
  }, [items, categoriaFiltro, busquedaTexto]);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/vencidos');
      const json = await res.json() as {
        data?: VencidoItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar productos vencidos');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      setObsLocal({});
    } catch {
      setError('Error al cargar productos vencidos');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  const guardarObservacion = useCallback(async (item: VencidoItem) => {
    const texto = textoObservacionEfectiva(item, obsLocal).trim();
    setGuardandoId(item.id);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/vencidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, accion_observacion: texto }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        accion_observacion?: string | null;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al guardar la observación');
        return;
      }
      const guardado = json.accion_observacion ?? null;
      setItems((prev) =>
        prev.map((x) => {
          if (x.id !== item.id) return x;
          const orig = x.cantidad_cargada_original;
          const vend = x.cantidad_vendida_acumulada;
          const obsTrim = String(guardado ?? '').trim();
          const ratio = orig > 0 ? Math.min(1, vend / orig) : null;
          const bajo50 = orig > 0 && vend * 2 < orig;
          return {
            ...x,
            accion_observacion: guardado,
            ratio_vendido_sobre_original: ratio,
            obligatorio_observacion_devolucion: bajo50 && !obsTrim,
          };
        })
      );
      setObsLocal((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch {
      setError('Error al guardar la observación');
    } finally {
      setGuardandoId(null);
    }
  }, [obsLocal]);

  async function marcarVendido(id: string, cantidadDisponible: number) {
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
      const res = await fetch(`/api/vencimientos/vencidos?${params.toString()}`, {
        method: 'PATCH',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; cantidad_restante?: number };
      if (!res.ok) {
        setError(json.error ?? 'Error al marcar como vendido');
        return;
      }
      const restante = Number(json.cantidad_restante ?? 0);
      setItems((prev) =>
        prev
          .map((x) => {
            if (x.id !== id) return x;
            const newVend = (x.cantidad_vendida_acumulada ?? 0) + cantidad;
            const orig = x.cantidad_cargada_original;
            const ratio = orig > 0 ? Math.min(1, newVend / orig) : null;
            const obs = (x.accion_observacion ?? '').trim();
            const bajo50 = orig > 0 && newVend * 2 < orig;
            return {
              ...x,
              cantidad: restante,
              cantidad_vendida_acumulada: newVend,
              ratio_vendido_sobre_original: ratio,
              obligatorio_observacion_devolucion: bajo50 && !obs,
            };
          })
          .filter((x) => x.cantidad > 0)
      );
    } catch {
      setError('Error al marcar como vendido');
    }
  }

  async function devolverTodos() {
    if (itemsFiltrados.length === 0) return;

    const bloqueados = itemsFiltrados.filter((i) => {
      const obs = textoObservacionEfectiva(i, obsLocal).trim();
      const orig = i.cantidad_cargada_original;
      const v = i.cantidad_vendida_acumulada;
      const bajo50 = orig > 0 && v * 2 < orig;
      return bajo50 && !obs;
    });
    if (bloqueados.length > 0) {
      setError(
        `No se puede devolver: hay ${bloqueados.length} producto(s) con menos del 50 % vendido sobre la carga original sin observación. Escribí una acción u observación en esas filas.`
      );
      return;
    }

    if (!confirm('¿Marcar como devueltos todos los productos listados?')) return;
    try {
      for (const i of itemsFiltrados) {
        if (obsLocal[i.id] === undefined) continue;
        const texto = obsLocal[i.id].trim();
        const server = (i.accion_observacion ?? '').trim();
        if (texto === server) continue;
        const resObs = await fetch('/api/vencimientos/vencidos', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: i.id, accion_observacion: texto }),
        });
        const jObs = (await resObs.json().catch(() => ({}))) as { error?: string };
        if (!resObs.ok) {
          setError(jObs.error ?? 'Error al guardar observaciones antes de devolver');
          return;
        }
      }

      const ids = itemsFiltrados.map((i) => i.id);
      const res = await fetch('/api/vencimientos/vencidos?devolver_todos=1', {
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
        setError((json.error ?? 'Error al devolver los productos') + extra);
        return;
      }
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((x) => !idSet.has(x.id)));
      setObsLocal((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    } catch {
      setError('Error al devolver los productos');
    }
  }

  const hayPendienteObs = useMemo(
    () =>
      itemsFiltrados.some((i) => {
        const orig = i.cantidad_cargada_original;
        const v = i.cantidad_vendida_acumulada;
        if (!(orig > 0 && v * 2 < orig)) return false;
        return !textoObservacionEfectiva(i, obsLocal).trim();
      }),
    [itemsFiltrados, obsLocal]
  );

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
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Productos vencidos</h1>
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, laboratorio..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-red-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Categoría macro</label>
                <select
                  value={categoriaFiltro}
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="min-w-[180px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100 dark:focus:border-red-400"
                >
                  <option value="">Todas</option>
                  <option value="FARMA">FARMA</option>
                  <option value="BIENESTAR">BIENESTAR</option>
                  <option value="PSICOTROPICOS">PSICOTROPICOS</option>
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
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Listado</h2>
          {hayPendienteObs ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Hay productos marcados que requieren observación antes de la devolución.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : itemsFiltrados.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500">
              No hay productos vencidos para los criterios actuales.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Producto</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Macro</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Vencimiento</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Cantidad.</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Restante</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Vendido</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 min-w-[220px]">
                      Acción realizada / observación
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {itemsFiltrados.map((r) => {
                    const dias = -diasHastaVencimiento(r.fecha_vencimiento);
                    const color = colorVencimiento(-dias);
                    const valObs = obsLocal[r.id] ?? r.accion_observacion ?? '';
                    const bajo50 =
                      r.cantidad_cargada_original > 0 &&
                      r.cantidad_vendida_acumulada * 2 < r.cantidad_cargada_original;
                    const alertaObs = bajo50 && !valObs.trim();
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{r.descripcion}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            {r.presentacion} · {r.laboratorio}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-600 dark:text-gray-400">{r.codigo_barras}</p>
                          {alertaObs ? (
                            <span className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                              Observación requerida para devolver
                            </span>
                          ) : null}
                          {r.venta_posterior_a_carga ? (
                            <span className="mt-1 ml-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                              Venta posterior a la carga
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700 dark:text-gray-300">
                          {r.categoria_macro ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-top text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800 dark:text-gray-200">{formatDate(r.fecha_vencimiento)}</span>
                            <span className={`text-[11px] ${color}`}>
                              Vencido hace {dias} día{dias !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-right text-xs tabular-nums text-gray-800 dark:text-gray-200">
                          {r.cantidad_cargada_original.toFixed(0)}
                        </td>
                        <td className="px-3 py-2 align-top text-right text-xs tabular-nums text-gray-800 dark:text-gray-200">
                          {Number(r.cantidad ?? 0).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 align-top text-right text-xs tabular-nums text-gray-800 dark:text-gray-200">
                          {r.cantidad_vendida_acumulada.toFixed(0)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <textarea
                            rows={2}
                            value={valObs}
                            onChange={(e) =>
                              setObsLocal((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            placeholder=""
                            className="w-full min-w-[200px] resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/30 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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
                        <td className="px-3 py-2 align-top text-right">
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
            </div>
          )}
        </CardContent>
      </Card>

      {itemsFiltrados.length > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void devolverTodos()}
            disabled={loading || hayPendienteObs}
            title={
              hayPendienteObs
                ? 'Completá y guardá las observaciones obligatorias antes de devolver'
                : undefined
            }
          >
            Devolver todos
          </Button>
        </div>
      )}
    </div>
  );
}
