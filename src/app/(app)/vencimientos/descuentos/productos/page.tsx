'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import DescuentosProductosListMobile from '@/components/vencimientos/DescuentosProductosListMobile';

type ProductoConDescuento = {
  codigo_barras: string;
  categoria_final: string;
  descuento: number;
  cantidad: number;
  dias_hasta: number;
};

type ApiResp = {
  data?: ProductoConDescuento[];
  meta?: {
    sucursal_id: number;
    sucursal_nombre: string;
    mes: string;
    anio: number;
    filename: string;
  };
  sucursales?: Array<{
    sucursal: number;
    nombrefantasia: string;
  }>;
  error?: string;
};

export default function ProductosConDescuentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<ProductoConDescuento[]>([]);
  const [meta, setMeta] = useState<ApiResp['meta']>(undefined);
  const [q, setQ] = useState('');
  const [categoriaFinalFiltro, setCategoriaFinalFiltro] = useState('');
  const [sucursalSel, setSucursalSel] = useState('');
  const [sucursales, setSucursales] = useState<Array<{ sucursal: number; nombrefantasia: string }>>([]);
  const [inicializadoSucursal, setInicializadoSucursal] = useState(false);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ modo: 'aplicar', days: '365', daysMin: '0' });
      if (sucursalSel) params.set('sucursal', sucursalSel);
      const res = await fetch(`/api/vencimientos/descuentos?${params.toString()}`);
      const json = (await res.json()) as ApiResp;
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar productos con descuentos');
        setItems([]);
        return;
      }
      setItems(json.data ?? []);
      setMeta(json.meta);
      setSucursales(json.sucursales ?? []);
      if (!inicializadoSucursal && json.meta?.sucursal_id) {
        setSucursalSel(String(json.meta.sucursal_id));
        setInicializadoSucursal(true);
      }
    } catch {
      setError('Error al cargar productos con descuentos');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, [sucursalSel, inicializadoSucursal]);

  const categoriasFinales = useMemo(
    () => Array.from(new Set(items.map((i) => i.categoria_final))).sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const filtrados = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((i) => {
      if (categoriaFinalFiltro && i.categoria_final !== categoriaFinalFiltro) return false;
      if (!qq) return true;
      return (
        i.codigo_barras.toLowerCase().includes(qq) ||
        i.categoria_final.toLowerCase().includes(qq) ||
        String(i.descuento).includes(qq)
      );
    });
  }, [items, q, categoriaFinalFiltro]);

  async function exportarCsv() {
    setError('');
    try {
      const params = new URLSearchParams({ modo: 'aplicar', csv: '1', days: '365', daysMin: '0' });
      if (sucursalSel) params.set('sucursal', sucursalSel);
      const res = await fetch(`/api/vencimientos/descuentos?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'No se pudo exportar CSV');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? meta?.filename ?? 'descuentos.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo exportar CSV');
    }
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
          <h1 className="text-xl font-bold text-gray-900">Productos con descuentos</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportarCsv} disabled={loading || filtrados.length === 0}>
            Exportar CSV
          </Button>
          <Link href="/vencimientos/descuentos">
            <Button size="sm" variant="outline">Configuración</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="grid w-full grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Sucursal</label>
              <select
                value={sucursalSel}
                onChange={(e) => setSucursalSel(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[260px]"
              >
                <option value="">Seleccionar sucursal</option>
                {sucursales.map((s) => (
                  <option key={s.sucursal} value={String(s.sucursal)}>
                    {s.nombrefantasia || `Sucursal ${s.sucursal}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Buscar</label>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Codebar o categoría final..."
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[240px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Categoría final</label>
              <select
                value={categoriaFinalFiltro}
                onChange={(e) => setCategoriaFinalFiltro(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 sm:min-w-[260px]"
              >
                <option value="">Todas</option>
                {categoriasFinales.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
              Actualizar
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">
            Listado {meta ? `· ${meta.sucursal_nombre} · ${meta.mes} ${meta.anio}` : ''}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : filtrados.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">No hay productos con descuento para mostrar.</p>
          ) : (
            <>
              <div className="md:hidden">
                <DescuentosProductosListMobile items={filtrados} />
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Codebar</th>
                    <th className="px-3 py-2 text-left font-medium">Categoría final</th>
                    <th className="px-3 py-2 text-right font-medium">Descuento</th>
                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-2 text-right font-medium">Días hasta venc.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtrados.map((i, idx) => (
                    <tr key={`${i.codigo_barras}-${idx}`}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">{i.codigo_barras}</td>
                      <td className="px-3 py-2 text-gray-800">{i.categoria_final}</td>
                      <td className="px-3 py-2 text-right text-red-700 font-semibold">{Math.round(i.descuento)}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{Math.round(i.cantidad)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{i.dias_hasta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
