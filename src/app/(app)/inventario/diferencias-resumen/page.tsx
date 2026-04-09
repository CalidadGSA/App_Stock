'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ArrowLeft } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ResumenRow {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  operadores?: string;
  diffCajasActual: number;
  diffUnidadesActual: number;
  diffCajasAnterior: number;
  diffUnidadesAnterior: number;
}

export default function DiferenciasResumenPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<ResumenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desdeActual, setDesdeActual] = useState('');
  const [hastaActual, setHastaActual] = useState('');
  const [categoriaMacro, setCategoriaMacro] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');

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
        if (categoriaMacro) {
          params.set('categoria_macro', categoriaMacro);
        }
        if (codigoBarras.trim()) {
          params.set('codigo_barras', codigoBarras.trim());
        }
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
  }, [searchParams, categoriaMacro, codigoBarras]);

  function exportarPdf() {
    if (items.length === 0) return;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const fechaGen = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const categoriaLabel = categoriaMacro || 'Todas';

    doc.setFontSize(14);
    doc.text('Reporte de diferencias de inventario', 40, 38);
    doc.setFontSize(10);
    doc.text(`Periodo: ${desdeActual || '-'} a ${hastaActual || '-'}`, 40, 56);
    doc.text(`Categoria macro: ${categoriaLabel}`, 40, 70);
    doc.text(`Generado: ${fechaGen}`, 40, 84);
    doc.text(`Registros: ${items.length}`, 40, 98);

    autoTable(doc, {
      startY: 112,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [243, 244, 246], textColor: [31, 41, 55] },
      head: [[
        'ID sistema',
        'Codigo barras',
        'Producto',
        'Presentacion',
        'Laboratorio',
        'Operador',
        'Diferencia (cajas)',
        'Diferencia (unid.)',
      ]],
      body: items.map((r) => [
        r.producto_id_sistema,
        r.codigo_barras || '-',
        r.descripcion || '-',
        r.presentacion || '-',
        r.laboratorio || '-',
        r.operadores || '-',
        r.diffCajasActual.toFixed(0),
        r.diffUnidadesActual.toFixed(0),
      ]),
      didDrawPage: () => {
        const pageSize = doc.internal.pageSize;
        doc.setFontSize(8);
        doc.text(
          `GestionStock - Diferencias resumen`,
          40,
          pageSize.getHeight() - 18
        );
      },
    });

    const safeDesde = (desdeActual || 'sin-desde').replace(/[^\d-]/g, '');
    const safeHasta = (hastaActual || 'sin-hasta').replace(/[^\d-]/g, '');
    doc.save(`diferencias-resumen_${safeDesde}_${safeHasta}.pdf`);
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
            Resumen de items con diferencia
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 text-sm text-gray-700">
            <div className="flex flex-col gap-1">
              <p className="font-medium">Diferencias por producto (últimos 60 días)</p>
              <p className="text-xs text-gray-500">
                Desde: {desdeActual || '-'} hasta: {hastaActual || '-'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">
                  Categoría macro
                </label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={categoriaMacro}
                  onChange={(e) => setCategoriaMacro(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="FARMA">FARMA</option>
                  <option value="BIENESTAR">BIENESTAR</option>
                  <option value="PSICOTROPICOS">PSICOTROPICOS</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">
                  Código de barras
                </label>
                <input
                  type="text"
                  value={codigoBarras}
                  onChange={(e) => setCodigoBarras(e.target.value)}
                  placeholder="Buscar código..."
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || items.length === 0}
                onClick={exportarPdf}
              >
                Exportar PDF
              </Button>
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
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Código barras
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Mes actual (cajas / unid.)
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Operador
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((r) => (
                    <tr key={`${r.producto_id_sistema}-${r.codigo_barras}`}>
                      <td className="px-4 py-2 align-middle">
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
                      <td className="px-4 py-2 align-middle text-center font-mono text-xs text-gray-700">
                        {r.codigo_barras}
                      </td>
                      <td className="px-4 py-2 align-middle text-center text-xs text-gray-800">
                        {r.diffCajasActual.toFixed(0)} / {r.diffUnidadesActual.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 align-middle text-center text-xs text-gray-700">
                        {r.operadores || '-'}
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

