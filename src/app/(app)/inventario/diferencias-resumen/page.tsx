'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';

interface ResumenRow {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  diffCajasActual: number;
  diffUnidadesActual: number;
  diffCajasAnterior: number;
  diffUnidadesAnterior: number;
}

export default function DiferenciasResumenPage() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ResumenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desdeActual, setDesdeActual] = useState('');
  const [hastaActual, setHastaActual] = useState('');

  useEffect(() => {
    async function cargar() {
      setLoading(true);
      setError('');
      try {
        const desdeAct = searchParams.get('desdeActual') ?? '';
        const hastaAct = searchParams.get('hastaActual') ?? '';
        setDesdeActual(desdeAct);
        setHastaActual(hastaAct);

        if (!desdeAct || !hastaAct) {
          setError('Faltan parámetros de fecha en la URL.');
          setItems([]);
          return;
        }

        const params = new URLSearchParams({
          desdeActual: desdeAct,
          hastaActual: hastaAct,
        });
        const res = await fetch(`/api/inventario/diferencias-resumen?${params.toString()}`);
        const json = (await res.json()) as {
          data?: ResumenRow[];
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar diferencias');
          setItems([]);
          return;
        }
        setItems(json.data ?? []);
      } catch {
        setError('Error al cargar diferencias');
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    void cargar();
  }, [searchParams]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Resumen de items con diferencia</h1>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            Volver al dashboard
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 text-sm text-gray-700">
            <p className="font-medium">Diferencias por producto (últimos 60 días)</p>
            <p className="text-xs text-gray-500">
              Desde: {desdeActual || '-'} hasta: {hastaActual || '-'}
            </p>
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
              No hay items con diferencias para los períodos seleccionados.
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
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Mes actual (cajas / unid.)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((r) => (
                    <tr key={`${r.producto_id_sistema}-${r.codigo_barras}`}>
                      <td className="px-4 py-2 align-top">
                        <p className="font-medium text-gray-900">
                          {r.descripcion}
                        </p>
                        <p className="text-xs text-gray-500">
                          {r.presentacion} · {r.laboratorio}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          ID sistema: {r.producto_id_sistema}
                        </p>
                      </td>
                      <td className="px-4 py-2 align-top font-mono text-xs text-gray-700">
                        {r.codigo_barras}
                      </td>
                      <td className="px-4 py-2 align-top text-right text-xs text-gray-800">
                        {r.diffCajasActual.toFixed(0)} / {r.diffUnidadesActual.toFixed(0)}
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

