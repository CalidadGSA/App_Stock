'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardList, AlertTriangle, CalendarClock, TrendingDown,
  ChevronRight, CheckCircle2, Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import type { DashboardStats } from '@/types';

function KpiCard({
  icon: Icon, label, value, sublabel, color,
}: {
  icon: React.ElementType; label: string; value: number | string;
  sublabel?: string; color: string;
}) {
  return (
    <Card className="flex flex-col">
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
            label="Inventarios totales"
            value={stats?.inventarios_total ?? 0}
            sublabel={`${stats?.inventarios_mes ?? 0} este mes`}
            color="bg-blue-100 text-blue-600"
          />
          <KpiCard
            icon={TrendingDown}
            label="Items con diferencia"
            value={stats?.items_con_diferencia ?? 0}
            sublabel="En todos los controles"
            color="bg-orange-100 text-orange-600"
          />
          <KpiCard
            icon={CalendarClock}
            label="Por vencer (30 días)"
            value={stats?.productos_por_vencer_30 ?? 0}
            sublabel={`${stats?.productos_por_vencer_60 ?? 0} en 60 días`}
            color="bg-yellow-100 text-yellow-600"
          />
          <KpiCard
            icon={AlertTriangle}
            label="Productos vencidos"
            value={stats?.productos_vencidos ?? 0}
            sublabel="Requieren atención"
            color="bg-red-100 text-red-600"
          />
        </div>
      </div>

      {/* Últimas actividades */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Últimos inventarios */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Últimos inventarios</h3>
              <Link href="/inventario/nuevo" className="text-xs text-blue-600 hover:underline">Ver todos</Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(stats?.ultimos_inventarios ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">Sin controles registrados aún.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {stats?.ultimos_inventarios.map(inv => (
                  <li key={inv.id}>
                    <Link
                      href={`/inventario/${inv.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {inv.estado === 'cerrado'
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          : <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                        }
                        <div>
                          <p className="text-sm font-medium text-gray-800">{formatDateTime(inv.fecha_inicio)}</p>
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
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Últimos controles de vencimientos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Últimos controles de vencimientos</h3>
              <Link href="/vencimientos/nuevo" className="text-xs text-blue-600 hover:underline">Ver todos</Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(stats?.ultimos_vencimientos ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">Sin controles registrados aún.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {stats?.ultimos_vencimientos.map(v => (
                  <li key={v.id}>
                    <Link
                      href={`/vencimientos/${v.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {v.estado === 'cerrado'
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          : <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                        }
                        <p className="text-sm font-medium text-gray-800">{formatDateTime(v.fecha_inicio)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={v.estado === 'cerrado' ? 'success' : 'warning'}>
                          {v.estado === 'cerrado' ? 'Cerrado' : 'En progreso'}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </Link>
                  </li>
                ))}
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
            <Link href="/vencimientos/nuevo">
              <Button variant="outline" size="sm" className="border-orange-300 text-orange-700 hover:bg-orange-100">
                Controlar
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
