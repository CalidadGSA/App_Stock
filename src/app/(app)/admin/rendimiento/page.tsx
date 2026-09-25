'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, RefreshCw, Users } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { PRESENCE_ADMIN_POLL_INTERVAL_MS } from '@/lib/auth/presence';
import type { HistorialMantenimientoRow } from '@/app/api/admin/historial-mantenimiento/route';
import { formatDateTime, formatDate } from '@/lib/utils';

export default function RendimientoAdminPage() {
  const router = useRouter();
  const [conectados, setConectados] = useState<number | null>(null);
  const [historial, setHistorial] = useState<HistorialMantenimientoRow[]>([]);
  const [fechaDia, setFechaDia] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const [resConectados, resHistorial] = await Promise.all([
          fetch('/api/admin/usuarios-conectados'),
          fetch('/api/admin/historial-mantenimiento'),
        ]);

        if (resConectados.status === 403 || resHistorial.status === 403) {
          router.replace('/dashboard');
          return;
        }

        const jsonConectados = await resConectados.json().catch(() => ({}));
        const jsonHistorial = await resHistorial.json().catch(() => ({}));

        if (!resConectados.ok) {
          throw new Error(jsonConectados.error ?? 'Error al cargar usuarios conectados');
        }
        if (!resHistorial.ok) {
          throw new Error(jsonHistorial.error ?? 'Error al cargar historial de mantenimiento');
        }

        setConectados(
          typeof jsonConectados.conectados === 'number' ? jsonConectados.conectados : 0
        );
        setHistorial((jsonHistorial.data ?? []) as HistorialMantenimientoRow[]);
        setFechaDia(String(jsonHistorial.fecha ?? ''));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar rendimiento');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch('/api/admin/usuarios-conectados');
          if (res.status === 403) return;
          const json = await res.json().catch(() => ({}));
          if (res.ok && typeof json.conectados === 'number') {
            setConectados(json.conectados);
          }
        } catch {
          // Mantener último valor.
        }
      })();
    }, PRESENCE_ADMIN_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Rendimiento
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Usuarios en línea e incidentes de mantenimiento del día
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void cargar({ silent: true })}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="py-12">
          <PageSpinner />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Usuarios conectados
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Operadores con actividad en los últimos 3 minutos
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-900 dark:bg-blue-950/30">
                <Users className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-3xl font-semibold tabular-nums text-blue-800 dark:text-blue-200">
                    {conectados == null ? '—' : conectados}
                  </p>
                  <p className="text-xs text-blue-700/80 dark:text-blue-300/80">
                    conectados ahora
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Problemas
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Historial del día en curso
                {fechaDia ? ` (${formatDate(fechaDia)})` : ''}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {historial.length === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                  No hay problemas registrados hoy.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[640px] w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                          Problema
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                          Inicio
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                          Fin
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {historial.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">
                            <p className="font-medium">{row.origen?.trim() || '—'}</p>
                            {row.notas?.trim() ? (
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {row.notas}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                            {formatDateTime(row.inicio_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                            {row.fin_at ? (
                              formatDateTime(row.fin_at)
                            ) : (
                              <span className="font-medium text-amber-700 dark:text-amber-300">
                                En curso
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
