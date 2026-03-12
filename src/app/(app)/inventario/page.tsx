'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import type { ControlInventario } from '@/types';

interface ApiResponse {
  data?: ControlInventario[];
  error?: string;
}

export default function InventarioListPage() {
  const [items, setItems] = useState<ControlInventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  async function cargar(p = 1) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', '20');
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);

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
    void cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAplicarFiltros() {
    void cargar(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Inventarios</h1>
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
              <Button size="sm" onClick={handleAplicarFiltros}>
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
                const tipo =
                  inv.origen === 'Auditoria'
                    ? 'Auditoría'
                    : (inv.descripcion ?? '').toLowerCase().includes('ocasional')
                      ? 'Inventario ocasional'
                      : 'Inventario diario';
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
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700">
                            {tipo}
                          </Badge>
                          {inv.descripcion && (
                            <p className="text-xs text-gray-500 truncate max-w-[220px]">
                              {inv.descripcion}
                            </p>
                          )}
                        </div>
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

