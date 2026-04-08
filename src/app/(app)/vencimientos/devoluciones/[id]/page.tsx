'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, formatDateTime } from '@/lib/utils';

type Cabecera = {
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
};

type DetalleRow = {
  id: string;
  devolucion_id: string;
  detalle_vencimiento_id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: string | null;
  accion_observacion: string | null;
};

export default function DevolucionDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [cabecera, setCabecera] = useState<Cabecera | null>(null);
  const [detalles, setDetalles] = useState<DetalleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Si el id de la ruta es inválido, evitamos llamar a la API
    if (!params?.id || params.id === 'undefined') {
      setError('Devolución no encontrada');
      setLoading(false);
      return;
    }

    async function cargar() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/vencimientos/devoluciones/${params.id}`);
        const json = (await res.json()) as {
          data?: { cabecera: Cabecera; detalles: DetalleRow[] };
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar la devolución');
          return;
        }
        setCabecera(json.data?.cabecera ?? null);
        setDetalles(json.data?.detalles ?? []);
      } catch {
        setError('Error al cargar la devolución');
      } finally {
        setLoading(false);
      }
    }

    void cargar();
  }, [params.id]);

  const totalCantidad = detalles.reduce((acc, d) => acc + (Number(d.cantidad) || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">
          Detalle de devolución
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/vencimientos/devoluciones')}
        >
          Volver
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-6">
            <PageSpinner />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      ) : !cabecera ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">
              No se encontró la devolución solicitada.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-gray-800">
                    Fecha de devolución
                  </p>
                  <p className="text-sm text-gray-700">
                    {formatDateTime(cabecera.fecha)}
                  </p>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {cabecera.sucursales?.nombrefantasia && (
                    <Badge
                      variant="outline"
                      className="text-[11px] px-2 py-0.5 border-gray-300 text-gray-700"
                    >
                      {cabecera.sucursales.nombrefantasia}
                    </Badge>
                  )}
                  {cabecera.operadores?.nombrecompleto && (
                    <p className="text-[11px] text-gray-500">
                      Operador: {cabecera.operadores.nombrecompleto}
                    </p>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-900">
                  Productos devueltos
                </h2>
                <p className="text-xs text-gray-500">
                  Total unidades: {totalCantidad.toFixed(2)}
                </p>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {detalles.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No hay productos asociados a esta devolución.
                </p>
              ) : (
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50 text-[11px] text-gray-600">
                      <th className="px-3 py-2 text-left font-medium">Producto</th>
                      <th className="px-3 py-2 text-left font-medium">Código</th>
                      <th className="px-3 py-2 text-left font-medium">Laboratorio</th>
                      <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                      <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                      <th className="px-3 py-2 text-left font-medium">Categoría</th>
                      <th className="px-3 py-2 text-left font-medium">Acción / observación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.map((d) => (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-800">
                              {d.descripcion}
                            </span>
                            {d.presentacion && (
                              <span className="text-[11px] text-gray-500">
                                {d.presentacion}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700">
                          {d.codigo_barras}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700">
                          {d.laboratorio ?? '-'}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700">
                          {formatDate(d.fecha_vencimiento)}
                        </td>
                        <td className="px-3 py-2 align-top text-right text-gray-800">
                          {Number(d.cantidad).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700">
                          {d.categoria_macro ?? '-'}
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-gray-700 max-w-[220px] whitespace-pre-wrap break-words">
                          {d.accion_observacion?.trim()
                            ? d.accion_observacion.trim()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

