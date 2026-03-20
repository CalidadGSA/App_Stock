'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

type DescuentoRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  subrubro_id: number | null;
  descuento: number;
};

export default function DescuentosVencimientosPage() {
  const router = useRouter();
  const [items, setItems] = useState<DescuentoRow[]>([]);
  const [meta, setMeta] = useState<{
    sucursal_nombre: string;
    mes: string;
    anio: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>(''); // categoria_macro

  const itemsFiltrados = useMemo(() => {
    let res = items;
    if (categoriaFiltro) {
      res = res.filter((i) => i.categoria_macro === categoriaFiltro);
    }
    const q = busquedaTexto.trim().toLowerCase();
    if (!q) return res;
    return res.filter((i) => {
      const texto = [
        i.descripcion,
        i.presentacion ?? '',
        i.laboratorio ?? '',
        i.codigo_barras,
        i.producto_id_sistema,
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(q);
    });
  }, [items, busquedaTexto, categoriaFiltro]);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos');
      const json = (await res.json()) as {
        data?: DescuentoRow[];
        error?: string;
        meta?: { sucursal_nombre: string; mes: string; anio: number };
      };
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar descuentos por vencimiento');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      if (json.meta) setMeta(json.meta);
    } catch {
      setError('Error al cargar descuentos por vencimiento');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function csvEscape(value: string) {
    const s = value.replace(/"/g, '""');
    // Solo escapamos con comillas si tiene coma, salto de línea o comillas
    if (/[,"\n\r]/.test(s)) return `"${s}"`;
    return s;
  }

  function descargarCSV() {
    const filas = itemsFiltrados;
    if (!filas || filas.length === 0) return;

    const hoy = new Date();
    const mesNombre =
      meta?.mes ??
      hoy.toLocaleString('es-ES', { month: 'long' });
    const anio = meta?.anio ?? hoy.getFullYear();
    const sucursalNombre = meta?.sucursal_nombre ?? 'Sucursal';

    const sanitize = (name: string) =>
      name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    const fileBase = sanitize(`${sucursalNombre} ${mesNombre} ${anio}`);

    // Sin cabecera. Columnas:
    // codebar, descuento (negativo), stock (cantidad)
    const csv = filas
      .map((i) => {
        const codebar = String(i.codigo_barras ?? '');
        const descuentoNeg = -Math.abs(Number(i.descuento ?? 0));
        const descuentoTxt = String(Math.round(descuentoNeg));
        const stockTxt = String(Math.round(Number(i.cantidad ?? 0)));
        return [codebar, descuentoTxt, stockTxt].map((v) => csvEscape(String(v))).join(',');
      })
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
            Descuentos por vencimientos cortos
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Filtros</p>
              <p className="text-xs text-gray-500">
                Los descuentos se calculan según la categoría y la cercanía a la fecha de vencimiento.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Buscar</label>
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder="Producto, código, laboratorio..."
                  className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Categoría</label>
                <select
                  value={categoriaFiltro}
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="min-w-[180px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Todas</option>
                  <option value="FARMA">FARMA</option>
                  <option value="BIENESTAR">BIENESTAR</option>
                  <option value="PSICOTROPICOS">PSICOTROPICOS</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Exportar
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={descargarCSV}
                  disabled={loading || itemsFiltrados.length === 0}
                >
                  Exportar a Excel (CSV)
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : itemsFiltrados.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              No hay productos con descuentos activos por vencimiento.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs text-gray-600">
                    <th className="px-3 py-2 text-left font-medium">Producto</th>
                    <th className="px-3 py-2 text-left font-medium">Categoría</th>
                    <th className="px-3 py-2 text-left font-medium">Fecha vencimiento</th>
                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-2 text-right font-medium">Descuento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itemsFiltrados.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {i.descripcion}
                          </span>
                          {i.presentacion && (
                            <span className="text-xs text-gray-500">
                              {i.presentacion}
                            </span>
                          )}
                          {i.laboratorio && (
                            <span className="text-[11px] text-gray-400">
                              {i.laboratorio}
                            </span>
                          )}
                          <span className="text-[11px] text-gray-400 mt-0.5">
                            Código: {i.codigo_barras}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {i.categoria_macro ?? '-'}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {formatDate(i.fecha_vencimiento)}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-xs text-gray-800">
                        {i.cantidad.toFixed(0)}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-xs font-semibold text-green-700">
                        {i.descuento.toFixed(0)}%
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

