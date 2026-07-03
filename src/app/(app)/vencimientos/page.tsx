'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import type { ControlVencimiento } from '@/types';
import { ArrowLeft } from 'lucide-react';

export default function VencimientosListPage() {
  const router = useRouter();
  const [items, setItems] = useState<ControlVencimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState<'todos' | 'en_progreso' | 'cerrado'>('todos');

  async function cargar(p = 1) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', '20');
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      if (estado !== 'todos') params.set('estado', estado);

      const res = await fetch(`/api/vencimientos?${params.toString()}`);
      const json = (await res.json()) as {
        data?: ControlVencimiento[];
        error?: string;
        total?: number;
        pageSize?: number;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar controles de vencimientos');
        return;
      }
      setItems(json.data ?? []);
      const total = json.total ?? (json.data?.length ?? 0);
      const pageSize = json.pageSize ?? 20;
      setHasMore(p * pageSize < total);
      setPage(p);
    } catch {
      setError('Error al cargar controles de vencimientos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar(1);
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
          <h1 className="text-xl font-bold text-gray-900">
            Controles de vencimientos
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Filtros por fecha
              </p>
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
          <h2 className="font-semibold text-gray-900">
            Controles de vencimientos
          </h2>
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
              No hay controles de vencimientos registrados con esos filtros.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/vencimientos/${c.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-gray-800">
                        {formatDateTime(c.fecha_inicio)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {c.observaciones && (
                          <p className="text-xs text-gray-500 truncate max-w-[260px]">
                            {c.observaciones}
                          </p>
                        )}
                        {c.categoria_macro && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                          >
                            {c.categoria_macro}
                          </Badge>
                        )}
                      </div>
                      {(() => {
                        // Nombre completo del operador desde join con operadores
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const op = (c as any).operadores;
                        const nombreCompleto =
                          (op?.nombrecompleto as string | undefined) ??
                          (op?.nombreCompleto as string | undefined) ??
                          '';
                        if (!nombreCompleto) return null;
                        return (
                          <p className="text-[11px] text-gray-500">
                            Operador: {nombreCompleto}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          c.estado === 'cerrado' ? 'success' : 'warning'
                        }
                      >
                        {c.estado === 'cerrado' ? 'Cerrado' : 'En progreso'}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
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

