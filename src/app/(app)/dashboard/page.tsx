'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList, AlertTriangle, CalendarClock, TrendingDown,
  ChevronRight, CheckCircle2, Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { etiquetaTipoControlInventario, inferirTipoControlInventario } from '@/lib/inventario/tipo-control';
import { formatDateTime } from '@/lib/utils';
import type { DashboardStats } from '@/types';

function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sublabel?: string;
  color: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <Card
      className={`flex flex-col ${clickable ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm font-medium text-gray-700">{label}</p>
          {sublabel && <p className="text-xs text-gray-500">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(({ data, error: err }) => {
        if (err) { setError(err); return; }
        setStats(data);
      })
      .catch(() => setError('Error al cargar estadísticas'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSpinner />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs — cuadros que luego podremos definir/ajustar */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Resumen</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={ClipboardList}
            label="Inventarios"
            value={stats?.inventarios_total ?? 0}
            sublabel="este mes"
            color="bg-blue-100 text-blue-600"
            onClick={() => {
              const hoy = new Date();
              const year = hoy.getFullYear();
              const month = hoy.getMonth(); // 0-11
              const first = new Date(year, month, 1);
              const last = new Date(year, month + 1, 0);
              const toYmd = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
              };
              const desde = toYmd(first);
              const hasta = toYmd(last);
              router.push(`/inventario?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
            }}
          />
          <KpiCard
            icon={TrendingDown}
            label="Items con diferencia"
            value={stats?.items_con_diferencia ?? 0}
            sublabel="en los últimos 60 días"
            color="bg-orange-100 text-orange-600"
            onClick={() => {
              const hoy = new Date();
              // Últimos 60 días (incluyendo hoy)
              const last = hoy;
              const first = new Date(hoy);
              first.setDate(first.getDate() - 59);
              const toYmd = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
              };
              const desdeActual = toYmd(first);
              const hastaActual = toYmd(last);
              router.push(
                `/inventario/diferencias-resumen?desdeActual=${encodeURIComponent(
                  desdeActual
                )}&hastaActual=${encodeURIComponent(
                  hastaActual
                )}`
              );
            }}
          />
          <KpiCard
            icon={CalendarClock}
            label="Por vencer en 30 días"
            value={stats?.productos_por_vencer_30 ?? 0}
            sublabel={`${stats?.productos_por_vencer_60 ?? 0} en 60 días · ${stats?.productos_por_vencer_90 ?? 0} en 90 días`}
            color="bg-yellow-100 text-yellow-600"
            onClick={() => {
              router.push('/vencimientos/por-vencer?days=365&daysMin=0');
            }}
          />
          <KpiCard
            icon={AlertTriangle}
            label="Productos vencidos"
            value={stats?.productos_vencidos ?? 0}
            sublabel="Requieren atención"
            color="bg-red-100 text-red-600"
            onClick={() => {
              router.push('/vencimientos/vencidos');
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-semibold text-gray-900">
              Progreso del trimestre actual
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Productos recontados respecto de la base asignada para esta sucursal.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(stats?.inventario_base_por_sucursal ?? []).length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">Sin datos de base_productos para el trimestre actual.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(stats?.inventario_base_por_sucursal ?? []).map((r) => (
                <li key={r.sucursal_id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-800">{r.sucursal_nombre}</p>
                    <Badge variant="outline">{r.inventariados}/{r.total}</Badge>
                  </div>
                  <div className="mt-2 h-2 w-full rounded bg-gray-100">
                    <div
                      className="h-2 rounded bg-blue-600"
                      style={{ width: `${Math.max(0, Math.min(100, r.porcentaje))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {r.porcentaje}% inventariado · pendientes: {r.pendientes}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Ajustes (solo admin) */}
      {(stats?.rol === 'admin' || stats?.rol === 'superadmin') && (
        <div className="flex justify-end">
          <Button
            size="lg"
            variant="secondary"
            className="border border-gray-300 text-gray-800 px-6 shadow-sm"
            onClick={() => (window.location.href = '/ajustes')}
          >
            Ajustes
          </Button>
        </div>
      )}

      {/* Últimas actividades */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Últimos inventarios */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Últimos inventarios</h3>
              <Link
                href="/inventario"
                className="text-xs text-blue-600 hover:underline"
              >
                Ver todos
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(stats?.ultimos_inventarios ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">Sin controles registrados aún.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {stats?.ultimos_inventarios.map(inv => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const op = (inv as any).operadores;
                  const operadorNombreCompleto =
                    (op?.nombrecompleto as string | undefined) ??
                    (op?.nombreCompleto as string | undefined) ??
                    '';
                  const tipo = etiquetaTipoControlInventario(
                    inferirTipoControlInventario(inv)
                  );
                  return (
                    <li key={inv.id}>
                      <Link
                        href={`/inventario/${inv.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {inv.estado === 'cerrado' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                          )}
                          <div>
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
                                <p className="text-xs text-gray-500 truncate max-w-[180px]">
                                  {inv.descripcion}
                                </p>
                              )}
                              {operadorNombreCompleto && (
                                <p className="text-[11px] text-gray-500">
                                  Operador: {operadorNombreCompleto}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={inv.estado === 'cerrado' ? 'success' : 'warning'}>
                            {inv.estado === 'cerrado' ? 'Cerrado' : 'En progreso'}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Últimos controles de vencimientos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Últimos controles de vencimientos</h3>
              <Link
                href="/vencimientos"
                className="text-xs text-blue-600 hover:underline"
              >
                Ver todos
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(stats?.ultimos_vencimientos ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">Sin controles registrados aún.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {stats?.ultimos_vencimientos.map((v) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const op = (v as any).operadores;
                  const nombreCompleto =
                    (op?.nombrecompleto as string | undefined) ??
                    (op?.nombreCompleto as string | undefined) ??
                    '';
                  return (
                    <li key={v.id}>
                      <Link
                        href={`/vencimientos/${v.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {v.estado === 'cerrado' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {formatDateTime(v.fecha_inicio)}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              {v.categoria_macro && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                                >
                                  {v.categoria_macro}
                                </Badge>
                              )}
                              {v.observaciones && (
                                <p className="text-xs text-gray-500 truncate max-w-[180px]">
                                  {v.observaciones}
                                </p>
                              )}
                            </div>
                            {nombreCompleto && (
                              <p className="text-[11px] text-gray-500">
                                Operador: {nombreCompleto}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={v.estado === 'cerrado' ? 'success' : 'warning'}>
                            {v.estado === 'cerrado' ? 'Cerrado' : 'En progreso'}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerta vencimientos */}
      {(stats?.productos_por_vencer_30 ?? 0) > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
              <div>
                <p className="font-medium text-orange-800">
                  {stats?.productos_por_vencer_30} producto{stats!.productos_por_vencer_30 > 1 ? 's' : ''} próximo{stats!.productos_por_vencer_30 > 1 ? 's' : ''} a vencer
                </p>
                <p className="text-sm text-orange-600">Vencen en los próximos 30 días</p>
              </div>
            </div>
            {/* Acción principal para vencimientos también está accesible desde el Navbar */}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
