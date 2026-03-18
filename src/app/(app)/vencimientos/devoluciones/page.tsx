'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

type DevolucionRow = {
  id: string;
  fecha: string;
  sucursal_id: number;
  usuario_id: number;
  sucursales?: {
    nombrefantasia?: string | null;
  } | null;
  operadores?: {
    nombrecompleto?: string | null;
  } | null;
  categoria_macro?: string | null;
};

const CATEGORIAS = ['FARMA', 'BIENESTAR', 'PSICOTROPICOS'] as const;

export default function DevolucionesVencimientosPage() {
  const router = useRouter();
  const [items, setItems] = useState<DevolucionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [categoriaMacro, setCategoriaMacro] = useState<string>('');

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      if (categoriaMacro) params.set('categoria_macro', categoriaMacro);

      const res = await fetch(`/api/vencimientos/devoluciones?${params.toString()}`);
      const json = (await res.json()) as { data?: DevolucionRow[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar devoluciones');
        return;
      }
      setItems(json.data ?? []);
    } catch {
      setError('Error al cargar devoluciones');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAplicarFiltros() {
    void cargar();
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
            Devoluciones de vencimientos
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Filtros
              </p>
              <p className="text-xs text-gray-500">
                Filtra por fecha de devolución y categoría macro (opcional).
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
                <label className="text-xs font-medium text-gray-700">
                  Categoría macro
                </label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={categoriaMacro}
                  onChange={(e) => setCategoriaMacro(e.target.value)}
                >
                  <option value="">Todas</option>
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" onClick={handleAplicarFiltros}>
                Aplicar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">
            Devoluciones registradas
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
              No hay devoluciones registradas con esos filtros.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((d) => {
                // Si por algún motivo no vino el id o viene corrupto, evitamos generar un link inválido
                if (!d.id || d.id === 'undefined') {
                  return null;
                }
                const suc = d.sucursales;
                const op = d.operadores;
                const nombreSucursal = suc?.nombrefantasia ?? '';
                const nombreOperador = op?.nombrecompleto ?? '';
                return (
                  <li key={d.id}>
                    <Link
                      href={`/vencimientos/devoluciones/${d.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium text-gray-800">
                          {formatDateTime(d.fecha)}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          {nombreSucursal && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                            >
                              {nombreSucursal}
                            </Badge>
                          )}
                          {d.categoria_macro && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-gray-300 text-gray-700"
                            >
                              {d.categoria_macro}
                            </Badge>
                          )}
                        </div>
                        {nombreOperador && (
                          <p className="text-[11px] text-gray-500">
                            Operador: {nombreOperador}
                          </p>
                        )}
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
  );
}

