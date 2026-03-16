'use client';

import { useEffect, useMemo, useState } from 'react';
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
}

export default function VencidosPage() {
  const router = useRouter();
  const [items, setItems] = useState<VencidoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(''); // categoria_macro
  const [busquedaTexto, setBusquedaTexto] = useState('');

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

  async function marcarVendido(id: string) {
    if (!confirm('¿Marcar este producto como vendido?')) return;
    try {
      const res = await fetch(`/api/vencimientos/vencidos?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al marcar como vendido');
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      setError('Error al marcar como vendido');
    }
  }

  async function devolverTodos() {
    if (itemsFiltrados.length === 0) return;
    if (!confirm('¿Marcar como devueltos todos los productos listados?')) return;
    try {
      const ids = itemsFiltrados.map((i) => i.id);
      const res = await fetch('/api/vencimientos/vencidos?devolver_todos=1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al devolver los productos');
        return;
      }
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((x) => !idSet.has(x.id)));
    } catch {
      setError('Error al devolver los productos');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Volver"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            Productos vencidos
          </h1>
        </div>
        <div className="flex items-center gap-2">
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
            <div>
              <p className="text-sm font-medium text-gray-800">Filtros</p>
              <p className="text-xs text-gray-500">
                Se muestran productos vencidos recientes según la categoría macro del control.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, laboratorio..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Categoría macro</label>
                <select
                  value={categoriaFiltro}
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="min-w-[180px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
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
          <h2 className="font-semibold text-gray-900">Listado</h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : itemsFiltrados.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              No hay productos vencidos para los criterios actuales.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Producto
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Categoría macro
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Vencimiento
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Cant.
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itemsFiltrados.map((r) => {
                    const dias = -diasHastaVencimiento(r.fecha_vencimiento); // días desde vencimiento
                    const color = colorVencimiento(-dias); // reutilizamos función
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 align-top">
                          <p className="font-medium text-gray-900">{r.descripcion}</p>
                          <p className="text-xs text-gray-500">
                            {r.presentacion} · {r.laboratorio}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                            {r.codigo_barras}
                          </p>
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-gray-700">
                          {r.categoria_macro ?? '-'}
                        </td>
                        <td className="px-4 py-2 align-top text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800">
                              {formatDate(r.fecha_vencimiento)}
                            </span>
                            <span className={`text-[11px] ${color}`}>
                              Vencido hace {dias} día{dias !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top text-right text-xs text-gray-800">
                          {Number(r.cantidad ?? 0).toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-top text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void marcarVendido(r.id)}
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
            disabled={loading}
          >
            Devolver todos
          </Button>
        </div>
      )}
    </div>
  );
}

