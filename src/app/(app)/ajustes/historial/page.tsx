'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import { calendarioActualArgentina, clampYmNoFuturo } from '@/lib/vencimientos-mes-anio-filtro';
import AjustesHistorialListMobile from '@/components/ajustes/AjustesHistorialListMobile';

interface AjusteRow {
  id: string;
  sucursal_id: number;
  usuario_id: number;
  fecha_creado: string;
  archivo_nombre: string;
  origen?: string | null;
}

interface SucursalOption {
  id: string;
  nombre: string;
}

export default function HistorialAjustesPage() {
  const router = useRouter();
  const [items, setItems] = useState<AjusteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [mes, setMes] = useState(''); // formato YYYY-MM
  const mesMaximoYm = calendarioActualArgentina().ym;

  useEffect(() => {
    async function cargarSucursales() {
      try {
        const res = await fetch('/api/admin/sucursales');
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar sucursales');
          return;
        }
        const list: SucursalOption[] = json.data ?? [];
        setSucursales(list);
      } catch {
        setError('Error al cargar sucursales');
      }
    }
    void cargarSucursales();
  }, []);

  async function cargar(p = 1) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', '20');
      if (mes) {
        params.set('month', mes);
      }
      if (sucursalId) {
        params.set('sucursal_id', sucursalId);
      }
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900">Historial de ajustes</h1>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => router.push('/ajustes')}
        >
          Volver a ajustes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Ajustes realizados</h2>
              <p className="text-sm text-gray-600">
                Listado para volver a descargar el archivo CSV original de cada ajuste.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
              <div className="flex w-full flex-col gap-1 sm:min-w-[180px] sm:w-auto">
                <label className="text-sm font-medium text-gray-700">
                  Sucursal
                </label>
                <select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Todas las sucursales</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-full flex-col gap-1 sm:w-auto">
                <label className="text-sm font-medium text-gray-700">
                  Mes
                </label>
                <input
                  type="month"
                  value={mes}
                  max={mesMaximoYm}
                  onChange={(e) => setMes(clampYmNoFuturo(e.target.value, mesMaximoYm))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => void cargar(1)}
                disabled={loading}
              >
                Aplicar filtros
              </Button>
            </div>
          </div>
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
            <>
            <div className="md:hidden">
              <AjustesHistorialListMobile
                items={items}
                onReexportar={(id) => void handleReexportar(id)}
              />
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[520px] w-full text-sm">
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
                          size="sm"
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
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={page <= 1 || loading}
          onClick={() => void cargar(page - 1)}
        >
          Página anterior
        </Button>
        <p className="text-center text-xs text-gray-500">Página {page}</p>
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={!hasMore || loading}
          onClick={() => void cargar(page + 1)}
        >
          Página siguiente
        </Button>
      </div>
    </div>
  );
}

