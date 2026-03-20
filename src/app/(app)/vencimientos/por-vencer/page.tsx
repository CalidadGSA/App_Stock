'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, diasHastaVencimiento, colorVencimiento } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

interface CategoriaOption {
  cod_rubro: number;
  nombre: string;
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
  cantidad: number;
  cod_rubro: number | null;
  categoria: string | null;
}

export default function PorVencerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PorVencerItem[]>([]);
  const [categorias, setCategorias] = useState<CategoriaOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);
  const [daysMin, setDaysMin] = useState(0);
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(''); // cod_rubro
   const [busquedaTexto, setBusquedaTexto] = useState('');
  const [rangeKey, setRangeKey] = useState<'30_all' | '60_all' | '90_all' | '60_only' | '90_only'>('30_all');

  const desdeHastaLabel = useMemo(() => {
    switch (rangeKey) {
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

  const itemsFiltrados = useMemo(() => {
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
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
  }, [items, busquedaTexto]);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const daysParam = parseInt(searchParams.get('days') ?? '30', 10) || 30;
      const daysMinParam = parseInt(searchParams.get('daysMin') ?? '0', 10) || 0;
      setDays(daysParam);
      setDaysMin(daysMinParam);
      // Determinar selección actual según (days, daysMin)
      if (daysParam === 30 && daysMinParam === 0) setRangeKey('30_all');
      else if (daysParam === 60 && daysMinParam === 31) setRangeKey('60_only');
      else if (daysParam === 60 && daysMinParam === 0) setRangeKey('60_all');
      else if (daysParam === 90 && daysMinParam === 61) setRangeKey('90_only');
      else if (daysParam === 90 && daysMinParam === 0) setRangeKey('90_all');
      else setRangeKey('30_all');
      const params = new URLSearchParams();
      params.set('days', String(daysParam));
      params.set('daysMin', String(daysMinParam));
      if (categoriaFiltro) {
        params.set('cod_rubro', categoriaFiltro);
      }
      const res = await fetch(`/api/vencimientos/por-vencer?${params.toString()}`);
      const json = await res.json() as {
        data?: PorVencerItem[];
        categorias?: CategoriaOption[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar productos por vencer');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      setCategorias(json.categorias ?? []);
    } catch {
      setError('Error al cargar productos por vencer');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, categoriaFiltro]);

  async function eliminarRegistro(id: string) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const res = await fetch(`/api/vencimientos/por-vencer?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar el registro');
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      setError('Error al eliminar el registro');
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
            Productos próximos a vencer ({desdeHastaLabel})
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vencimientos/descuentos">
            <Button size="sm" variant="outline">
              Descuentos
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
            <div>
              <p className="text-sm font-medium text-gray-800">Filtros</p>
              <p className="text-xs text-gray-500">
                Ordenado por fecha de vencimiento.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Periodo</label>
                <select
                    value={rangeKey}
                  onChange={(e) => {
                      const nextKey = e.target.value as typeof rangeKey;
                      let nextDays = 30;
                      let nextDaysMin = 0;
                      if (nextKey === '60_all') {
                        nextDays = 60;
                        nextDaysMin = 0;
                      }
                      if (nextKey === '90_all') {
                        nextDays = 90;
                        nextDaysMin = 0;
                      }
                      if (nextKey === '60_only') {
                        nextDays = 60;
                        nextDaysMin = 31;
                      }
                      if (nextKey === '90_only') {
                        nextDays = 90;
                        nextDaysMin = 61;
                      }
                    const params = new URLSearchParams(searchParams.toString());
                      params.set('days', String(nextDays));
                      params.set('daysMin', String(nextDaysMin));
                      setRangeKey(nextKey);
                    router.push(`/vencimientos/por-vencer?${params.toString()}`);
                  }}
                  className="min-w-[120px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    <option value="30_all">Últimos 30 días</option>
                    <option value="60_all">Últimos 60 días</option>
                    <option value="90_all">Últimos 90 días</option>
                    <option value="60_only">Solo a 60 días</option>
                    <option value="90_only">Solo a 90 días</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, laboratorio..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Categoría</label>
                <select
                  value={categoriaFiltro}
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Todas</option>
                  {categorias.map((c) => (
                    <option key={c.cod_rubro} value={String(c.cod_rubro)}>
                      {c.nombre}
                    </option>
                  ))}
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
              No hay productos por vencer con esos filtros.
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
                      Categoría
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
                    const dias = diasHastaVencimiento(r.fecha_vencimiento);
                    const color = colorVencimiento(dias);
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
                          {r.categoria ?? '-'}
                        </td>
                        <td className="px-4 py-2 align-top text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-800">{formatDate(r.fecha_vencimiento)}</span>
                            <span className={`text-[11px] ${color}`}>
                              {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
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
                            onClick={() => void eliminarRegistro(r.id)}
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
    </div>
  );
}

