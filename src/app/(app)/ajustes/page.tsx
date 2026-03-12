'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';

interface SucursalOption {
  id: string;
  nombre: string;
}

interface DiferenciaItem {
  id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
  origen?: string | null;
  diffCajas: number;
  diffUnidades: number;
}

export default function AjustesPage() {
  const router = useRouter();
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [origenFiltro, setOrigenFiltro] = useState<'todos' | 'Sucursal' | 'Auditoria'>('todos');
  const [loadingSucursales, setLoadingSucursales] = useState(true);
  const [loadingDiferencias, setLoadingDiferencias] = useState(false);
  const [diferencias, setDiferencias] = useState<DiferenciaItem[]>([]);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function cargarSucursales() {
      setLoadingSucursales(true);
      try {
        const res = await fetch('/api/admin/sucursales');
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar sucursales');
          return;
        }
        const list: SucursalOption[] = json.data ?? [];
        setSucursales(list);
        if (list.length === 1) {
          setSucursalId(list[0].id);
        }
      } catch {
        setError('Error al cargar sucursales');
      } finally {
        setLoadingSucursales(false);
      }
    }
    void cargarSucursales();
  }, []);

  async function cargarDiferencias() {
    setError('');
    setDiferencias([]);
    if (!sucursalId || !desde || !hasta) {
      setError('Seleccioná sucursal, fecha desde y fecha hasta.');
      return;
    }
    if (hasta < desde) {
      setError('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
      return;
    }
    setLoadingDiferencias(true);
    try {
      const params = new URLSearchParams({
        sucursal_id: sucursalId,
        desde,
        hasta,
      });
      if (origenFiltro !== 'todos') {
        params.set('origen', origenFiltro);
      }
      const res = await fetch(`/api/inventario/diferencias?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar diferencias');
        return;
      }
      const items: DiferenciaItem[] = (json.data ?? []).map((r: any) => {
        const sistC = r.stock_sist_cajas ?? 0;
        const sistU = r.stock_sist_unidades ?? 0;
        const realC = r.stock_real_cajas ?? 0;
        const realU = r.stock_real_unidades ?? 0;
        return {
          id: r.id,
          producto_id_sistema: r.producto_id_sistema,
          codigo_barras: r.codigo_barras,
          descripcion: r.descripcion,
          presentacion: r.presentacion ?? null,
          laboratorio: r.laboratorio ?? null,
          stock_sist_cajas: r.stock_sist_cajas,
          stock_sist_unidades: r.stock_sist_unidades,
          stock_real_cajas: r.stock_real_cajas,
          stock_real_unidades: r.stock_real_unidades,
          origen: r.controles_inventario?.origen ?? null,
          diffCajas: realC - sistC,
          diffUnidades: realU - sistU,
        };
      });
      setDiferencias(items);
    } catch {
      setError('Error al cargar diferencias');
    } finally {
      setLoadingDiferencias(false);
    }
  }

  async function handleEliminarDiferencia(id: string) {
    setError('');
    try {
      const res = await fetch(`/api/inventario/diferencias?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar diferencia');
        return;
      }
      setDiferencias((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError('Error al eliminar diferencia');
    }
  }

  async function handleExportar() {
    setError('');
    if (!sucursalId || !desde || !hasta) {
      setError('Seleccioná sucursal, fecha desde y fecha hasta.');
      return;
    }
    if (hasta < desde) {
      setError('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
      return;
    }
    if (diferencias.length === 0) {
      setError('No hay diferencias para exportar con los filtros seleccionados.');
      return;
    }
    setExportando(true);
    try {
      const params = new URLSearchParams({
        sucursal_id: sucursalId,
        desde,
        hasta,
      });
      // Si el origen es "todos" exportamos diferencias de ambos orígenes.
      if (origenFiltro !== 'todos') {
        params.set('origen', origenFiltro);
      }
      const res = await fetch(`/api/inventario/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Error al exportar diferencias');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? 'inventario.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Error al exportar diferencias');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Ajustes</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/dashboard')}
        >
          Volver al dashboard
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">
            Exportar diferencias de inventario
          </h2>
          <p className="text-sm text-gray-600">
            Seleccioná una sucursal y un período para exportar las diferencias de inventario a un archivo CSV.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingSucursales ? (
            <PageSpinner />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Sucursal
                </label>
                <select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Seleccionar sucursal</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const hoy = new Date();
                    const yyyy = hoy.getFullYear();
                    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
                    const dd = String(hoy.getDate()).padStart(2, '0');
                    const hoyStr = `${yyyy}-${mm}-${dd}`;
                    setDesde(hoyStr);
                    setHasta(hoyStr);
                  }}
                >
                  Hoy
                </Button>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">
                    Origen
                  </label>
                  <select
                    value={origenFiltro}
                    onChange={(e) =>
                      setOrigenFiltro(e.target.value as 'todos' | 'Sucursal' | 'Auditoria')
                    }
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                      focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="todos">Todos</option>
                    <option value="Sucursal">Sucursal</option>
                    <option value="Auditoria">Auditoría</option>
                  </select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={cargarDiferencias}
                  disabled={loadingDiferencias}
                >
                  Ver diferencias
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleExportar}
                  loading={exportando}
                  disabled={
                    exportando ||
                    !sucursalId ||
                    !desde ||
                    !hasta ||
                    diferencias.length === 0
                  }
                >
                  Exportar CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push('/ajustes/historial')}
                >
                  Ver historial de ajustes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">
            Diferencias pendientes de ajuste
          </h2>
          <p className="text-sm text-gray-600">
            Solo se muestran los ítems con diferencias en cajas o unidades que aún no fueron ajustados.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loadingDiferencias ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : diferencias.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              No hay diferencias pendientes para los filtros seleccionados.
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
                      Código barras
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Origen
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Sist. (cajas/unid.)
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Real (cajas/unid.)
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Diferencia
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diferencias.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">
                          {d.descripcion}
                        </p>
                        <p className="text-xs text-gray-500">
                          {d.presentacion} · {d.laboratorio}
                        </p>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">
                        {d.codigo_barras}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {d.origen === 'Auditoria' ? 'Auditoría' : 'Sucursal'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {(d.stock_sist_cajas ?? 0).toString()} /{' '}
                        {(d.stock_sist_unidades ?? 0).toString()}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {(d.stock_real_cajas ?? 0).toString()} /{' '}
                        {(d.stock_real_unidades ?? 0).toString()}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {d.diffCajas.toFixed(0)} / {d.diffUnidades.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => void handleEliminarDiferencia(d.id)}
                        >
                          Quitar
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
    </div>
  );
}

