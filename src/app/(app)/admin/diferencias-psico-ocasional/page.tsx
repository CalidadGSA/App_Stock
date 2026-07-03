'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pill } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, formatDateTime, fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import type {
  DiferenciaPsicoOcasionalItem,
  DiferenciaPsicoOcasionalSucursal,
} from '@/app/api/admin/diferencias-psico-ocasional/route';
import DiferenciasPsicoListMobile from '@/components/admin/DiferenciasPsicoListMobile';

interface SucursalOption {
  id: string;
  nombre: string;
}

interface ResumenData {
  desde: string;
  hasta: string;
  solo_pendientes: boolean;
  sucursal_id: number | null;
  totales: {
    sucursales_con_diferencias: number;
    items: number;
    psicotropicos: number;
    estupefacientes: number;
    diff_cajas: number;
    diff_unidades: number;
  };
  sucursales: DiferenciaPsicoOcasionalSucursal[];
}

function defaultDesde(): string {
  return ymdAddDays(fechaHoyArgentinaYmd(), -90);
}

function badgeVariant(tipo: DiferenciaPsicoOcasionalItem['tipo_controlado']) {
  return tipo === 'estupefaciente' ? 'danger' : 'warning';
}

export default function DiferenciasPsicoOcasionalPage() {
  const router = useRouter();
  const [desde, setDesde] = useState(defaultDesde);
  const [hasta, setHasta] = useState(() => fechaHoyArgentinaYmd());
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [sucursalId, setSucursalId] = useState('');
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [data, setData] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function cargarSucursales() {
      try {
        const res = await fetch('/api/sucursales');
        const json = await res.json();
        if (res.ok) {
          setSucursales(json.data ?? []);
        }
      } catch {
        // Ignorar: el filtro queda solo con "Todas"
      }
    }
    void cargarSucursales();
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ desde, hasta, solo_pendientes: soloPendientes ? '1' : '0' });
      if (sucursalId) params.set('sucursal_id', sucursalId);
      const res = await fetch(`/api/admin/diferencias-psico-ocasional?${params.toString()}`);
      const json = await res.json();
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar diferencias');
        return;
      }
      setData(json.data ?? null);
    } catch {
      setError('Error al cargar diferencias de psicotrópicos');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, soloPendientes, sucursalId, router]);

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          aria-label="Volver"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Diferencias psicotrópicos / estupefacientes
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Inventarios ocasionales de sucursal ya cerrados.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Filtros</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:min-w-[200px]">
            <span className="text-gray-600 dark:text-gray-400">Sucursal</span>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Desde</span>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Hasta</span>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
            <input
              type="checkbox"
              checked={soloPendientes}
              onChange={(e) => setSoloPendientes(e.target.checked)}
              className="rounded border-gray-300"
            />
            Solo sin ajustar
          </label>
          <Button onClick={() => void cargar()} disabled={loading}>
            {loading ? 'Cargando…' : 'Aplicar'}
          </Button>
        </CardContent>
      </Card>

      {loading && <PageSpinner />}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {data.totales.sucursales_con_diferencias}
                </p>
                <p className="text-xs text-gray-500">Sucursales</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.totales.items}</p>
                <p className="text-xs text-gray-500">Líneas con diferencia</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {data.totales.psicotropicos}
                </p>
                <p className="text-xs text-gray-500">Psicotrópicos</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                  {data.totales.estupefacientes}
                </p>
                <p className="text-xs text-gray-500">Estupefacientes</p>
              </CardContent>
            </Card>
          </div>

          {data.sucursales.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-gray-500">
                No hay diferencias de psicotrópicos o estupefacientes en inventarios ocasionales de sucursal cerrados
                {data.solo_pendientes ? ' pendientes de ajuste' : ''}
                {data.sucursal_id
                  ? ` en la sucursal seleccionada`
                  : ''}{' '}
                entre {formatDate(data.desde)} y {formatDate(data.hasta)}.
              </CardContent>
            </Card>
          ) : (
            data.sucursales.map((suc) => (
              <Card key={suc.sucursal_id}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pill className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                        {suc.sucursal_nombre}
                      </h2>
                      <p className="text-xs text-gray-500">
                        {suc.total_items} ítems · {suc.total_psicotropicos} psicotrópicos ·{' '}
                        {suc.total_estupefacientes} estupefacientes · Dif. {suc.diff_cajas} cajas /{' '}
                        {suc.diff_unidades} unid.
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="md:hidden">
                    <DiferenciasPsicoListMobile items={suc.items} />
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/50">
                        <th className="px-4 py-2">Tipo</th>
                        <th className="px-4 py-2">Producto</th>
                        <th className="px-4 py-2">Código</th>
                        <th className="px-4 py-2 text-right">Dif. Cajas</th>
                        <th className="px-4 py-2 text-right">Dif. Unid.</th>
                        <th className="px-4 py-2">Control</th>
                        <th className="px-4 py-2">Ajuste</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {suc.items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-900/40">
                          <td className="px-4 py-3">
                            <Badge variant={badgeVariant(item.tipo_controlado)}>
                              {item.tipo_controlado_label}
                            </Badge>
                            {item.psicofarmaco_nombre && (
                              <p className="mt-0.5 text-[10px] text-gray-500">{item.psicofarmaco_nombre}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 dark:text-gray-100">{item.descripcion}</p>
                            {item.presentacion && (
                              <p className="text-xs text-gray-500">{item.presentacion}</p>
                            )}
                            {item.laboratorio && (
                              <p className="text-xs text-gray-400">{item.laboratorio}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                            {item.codigo_barras || '—'}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-medium ${
                              item.diff_cajas !== 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400'
                            }`}
                          >
                            {item.diff_cajas > 0 ? '+' : ''}
                            {item.diff_cajas}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-medium ${
                              item.diff_unidades !== 0
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-gray-400'
                            }`}
                          >
                            {item.diff_unidades > 0 ? '+' : ''}
                            {item.diff_unidades}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {formatDateTime(item.fecha_control)}
                          </td>
                          <td className="px-4 py-3">
                            {item.ajustado ? (
                              <Badge variant="outline">Ajustado</Badge>
                            ) : (
                              <Badge variant="warning">Pendiente</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
