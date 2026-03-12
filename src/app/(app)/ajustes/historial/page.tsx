'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';

interface AjusteRow {
  id: string;
  sucursal_id: number;
  usuario_id: number;
  fecha_creado: string;
  archivo_nombre: string;
  origen?: string | null;
}

export default function HistorialAjustesPage() {
  const router = useRouter();
  const [items, setItems] = useState<AjusteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function cargar(p = 1) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', '20');
      const res = await fetch(`/api/ajustes?${params.toString()}`);
      const json = await res.json() as {
        data?: AjusteRow[];
        error?: string;
        total?: number;
        pageSize?: number;
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar ajustes');
        return;
      }
      const list = json.data ?? [];
      setItems(list);
      const total = json.total ?? list.length;
      const pageSize = json.pageSize ?? 20;
      setHasMore(p * pageSize < total);
      setPage(p);
    } catch {
      setError('Error al cargar ajustes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReexportar(id: string) {
    try {
      const res = await fetch(`/api/ajustes/${encodeURIComponent(id)}/export`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Error al re-exportar ajuste');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? 'ajuste.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Error al re-exportar ajuste');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Historial de ajustes</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/ajustes')}
        >
          Volver a ajustes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Ajustes realizados</h2>
          <p className="text-sm text-gray-600">
            Listado de exportaciones de diferencias realizadas. Podés volver a descargar el archivo CSV original de cada ajuste.
          </p>
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
              Todavía no hay ajustes registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Fecha
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Origen
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Archivo
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {formatDateTime(a.fecha_creado)}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {a.origen === 'Auditoria'
                          ? 'Auditoría'
                          : a.origen === 'Sucursal'
                            ? 'Sucursal'
                            : a.origen === 'Ambos'
                              ? 'Ambos'
                              : 'Desconocido'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {a.archivo_nombre}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void handleReexportar(a.id)}
                        >
                          Descargar CSV
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

