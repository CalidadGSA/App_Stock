'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Pill, RefreshCw, Search } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import {
  descargarPdfPsicotropicos,
  formatCantidad,
  formatImporte,
  type DatosListadoPsicotropicos,
} from '@/lib/stock/pdf-psicotropicos';

export default function PsicotropicosEnStockPage() {
  const [datos, setDatos] = useState<DatosListadoPsicotropicos | null>(null);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/stock/psicotropicos', { cache: 'no-store' });
      const json = (await res.json()) as { data?: DatosListadoPsicotropicos; error?: string };
      if (!res.ok || !json.data) {
        setError(json.error ?? 'No se pudo cargar el stock de psicotrópicos');
        setDatos(null);
        return;
      }
      setDatos(json.data);
    } catch {
      setError('Error de red al cargar el stock de psicotrópicos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const productos = datos?.productos ?? [];
    const t = busqueda.trim().toLowerCase();
    if (!t) return productos;
    return productos.filter(
      (p) =>
        p.producto.toLowerCase().includes(t) ||
        p.laboratorio.toLowerCase().includes(t) ||
        p.codebar.includes(t) ||
        String(p.idproducto) === t
    );
  }, [datos, busqueda]);

  const totalCajas = useMemo(() => visibles.reduce((acc, p) => acc + p.cajas, 0), [visibles]);
  const totalPvp = useMemo(() => visibles.reduce((acc, p) => acc + (p.pvpTotal ?? 0), 0), [visibles]);

  async function generarPdf() {
    setGenerando(true);
    try {
      // El PDF lleva la hora en que se imprime: se vuelve a pedir el stock para que coincida.
      const res = await fetch('/api/stock/psicotropicos', { cache: 'no-store' });
      const json = (await res.json()) as { data?: DatosListadoPsicotropicos; error?: string };
      if (!res.ok || !json.data) {
        setError(json.error ?? 'No se pudo generar el PDF');
        return;
      }
      setDatos(json.data);
      await descargarPdfPsicotropicos(json.data);
    } catch {
      setError('Error al generar el PDF');
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            <Pill className="h-5 w-5 text-blue-600" />
            Psicotrópicos en stock
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {datos
              ? `${datos.sucursal.nombre} · actualizado ${formatDateTime(datos.generado_at)}`
              : 'Listado imprimible de los psicotrópicos con existencia en la sucursal'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={loading || generando}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
          <Button
            size="sm"
            onClick={() => void generarPdf()}
            loading={generando}
            disabled={loading || !datos || datos.productos.length === 0}
          >
            {!generando && <FileDown className="h-4 w-4" />}
            Descargar PDF
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && <PageSpinner />}

      {!loading && datos && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Productos</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {visibles.length.toLocaleString('es-AR')}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Cajas</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {totalCajas.toLocaleString('es-AR')}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">PVP total</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">$ {formatImporte(totalPvp)}</p>
              </div>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar producto, laboratorio o código…"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {visibles.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-gray-500">
                {datos.productos.length === 0
                  ? 'La sucursal no tiene psicotrópicos en stock.'
                  : 'Ningún producto coincide con la búsqueda.'}
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                        <th className="px-4 py-2 font-medium">Codebar</th>
                        <th className="px-4 py-2 font-medium">Producto</th>
                        <th className="px-4 py-2 font-medium">Laboratorio</th>
                        <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                        <th className="px-4 py-2 text-right font-medium">PVP total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((p) => (
                        <tr key={p.idproducto} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="px-4 py-2 tabular-nums text-gray-600 dark:text-gray-400">{p.codebar || '—'}</td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{p.producto}</td>
                          <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{p.laboratorio || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatCantidad(p)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatImporte(p.pvpTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-gray-100 md:hidden dark:divide-gray-800">
                  {visibles.map((p) => (
                    <li key={p.idproducto} className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.producto}</p>
                      <p className="text-xs text-gray-500">
                        {p.codebar || '—'} · {p.laboratorio || '—'}
                      </p>
                      <div className="mt-1 flex justify-between text-sm">
                        <span>
                          Cantidad: <span className="font-semibold tabular-nums">{formatCantidad(p)}</span>
                        </span>
                        <span className="tabular-nums">$ {formatImporte(p.pvpTotal)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
