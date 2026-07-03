'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { etiquetaTipoControlInventario, inferirTipoControlInventario } from '@/lib/inventario/tipo-control';
import { formatDateTime } from '@/lib/utils';
import type { ControlInventario } from '@/types';
import { ArrowLeft } from 'lucide-react';

interface ApiResponse {
  data?: ControlInventario[];
  error?: string;
}

export default function InventarioListPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<ControlInventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [desde, setDesde] = useState(() => searchParams.get('desde') ?? '');
  const [hasta, setHasta] = useState(() => searchParams.get('hasta') ?? '');
  const [estado, setEstado] = useState<'todos' | 'en_progreso' | 'cerrado'>('todos');

  async function cargar(
    p = 1,
    filtros?: { desde?: string; hasta?: string; estado?: typeof estado },
  ) {
    setLoading(true);
    setError('');
    try {
      const desdeFiltro = filtros?.desde ?? desde;
      const hastaFiltro = filtros?.hasta ?? hasta;
      const estadoFiltro = filtros?.estado ?? estado;
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', '20');
      if (desdeFiltro) params.set('desde', desdeFiltro);
      if (hastaFiltro) params.set('hasta', hastaFiltro);
      if (estadoFiltro !== 'todos') params.set('estado', estadoFiltro);

      const res = await fetch(`/api/inventario?${params.toString()}`);
      const json = (await res.json()) as {
        data?: ControlInventario[];
        error?: string;
        total?: number;
        pageSize?: number;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar inventarios');
        return;
      }
      setItems(json.data ?? []);
      const total = json.total ?? (json.data?.length ?? 0);
      const pageSize = json.pageSize ?? 20;
      setHasMore(p * pageSize < total);
      setPage(p);
    } catch {
      setError('Error al cargar inventarios');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const desdeUrl = searchParams.get('desde') ?? '';
    const hastaUrl = searchParams.get('hasta') ?? '';
    if (desdeUrl) setDesde(desdeUrl);
    if (hastaUrl) setHasta(hastaUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    void cargar(1, {
      desde: searchParams.get('desde') ?? '',
      hasta: searchParams.get('hasta') ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAplicarFiltros() {
    void cargar(1);
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
          <h1 className="text-xl font-bold text-gray-900">Inventarios</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Filtros por fecha</p>
              <p className="text-xs text-gray-500">
                Filtra por fecha de inicio del control.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
              <Input
                label="Hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Estado</label>
                <select
                  value={estado}
                  onChange={(e) =>
                    setEstado(e.target.value as 'todos' | 'en_progreso' | 'cerrado')
                  }
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="todos">Todos</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="cerrado">Cerrado</option>
                </select>
              </div>
              <Button size="sm" onClick={handleAplicarFiltros} disabled={loading}>
                Aplicar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Controles de inventario</h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : items.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              No hay controles de inventario registrados con esos filtros.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((inv) => {
                const tipo = etiquetaTipoControlInventario(
                  inferirTipoControlInventario(inv)
                );
                // Nombre completo del operador que realizó el inventario (join con operadores)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const operadorNombreCompleto =
                  ((inv as any).operadores?.nombrecompleto as string | undefined) ??
                  // Fallback por si en algún momento se mapea a otra propiedad
                  ((inv as any).operadores?.nombreCompleto as string | undefined) ??
                  '';
                return (
                  <li key={inv.id}>
                    <Link
                      href={`/inventario/${inv.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium text-gray-800">
                          {formatDateTime(inv.fecha_inicio)}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                          >
                            {tipo}
                          </Badge>
                          {inv.categoria_macro && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                            >
                              {inv.categoria_macro}
                            </Badge>
                          )}
                          {inv.descripcion && (
                            <p className="text-xs text-gray-500 truncate max-w-[220px]">
                              {inv.descripcion}
                            </p>
                          )}
                        </div>
                        {operadorNombreCompleto && (
                          <p className="text-[11px] text-gray-500">
                            Operador: {operadorNombreCompleto}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            inv.estado === 'cerrado' ? 'success' : 'warning'
                          }
                        >
                          {inv.estado === 'cerrado' ? 'Cerrado' : 'En progreso'}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => void cargar(page - 1)}
        >
          Página anterior
        </Button>
        <p className="text-xs text-gray-500">Página {page}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasMore || loading}
          onClick={() => void cargar(page + 1)}
        >
          Página siguiente
        </Button>
      </div>
    </div>
  );
}

