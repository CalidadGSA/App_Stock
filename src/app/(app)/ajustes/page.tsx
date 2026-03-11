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

export default function AjustesPage() {
  const router = useRouter();
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loadingSucursales, setLoadingSucursales] = useState(true);
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

  async function handleExportar() {
    setError('');
    if (!sucursalId || !desde || !hasta) {
      setError('Seleccioná sucursal, fecha desde y fecha hasta.');
      return;
    }
    setExportando(true);
    try {
      const params = new URLSearchParams({
        sucursal_id: sucursalId,
        desde,
        hasta,
      });
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
              </div>
              {error && (
                <p className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div>
                <Button
                  size="sm"
                  onClick={handleExportar}
                  loading={exportando}
                >
                  Exportar CSV
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

