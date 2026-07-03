'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fechaHoyArgentinaYmd, ymdAddDays, formatDateTime } from '@/lib/utils';
import { clientHasPermission } from '@/lib/auth/permissions-client';
import {
  ORIGENES_DIFERENCIA_FILTRO,
  TIPOS_INVENTARIO_AUDITORIA_FILTRO,
  TIPOS_INVENTARIO_FILTRO,
  TIPOS_INVENTARIO_SUCURSAL_FILTRO,
} from '@/lib/inventario/diferencias-consolidado-tipos';
import { etiquetaTipoControlInventario } from '@/lib/inventario/tipo-control';
import type { TipoControlInventario } from '@/lib/inventario/tipo-control';
import DiferenciasResumenListMobile from '@/components/inventario/DiferenciasResumenListMobile';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_STICKY_THEAD,
  DATATABLE_PAGE_ROOT,
} from '@/components/list/datatable-classes';
import { DatatableListSection } from '@/components/list/DatatableListSection';
import {
  usePaginacionServidor,
  useTotalPaginas,
} from '@/components/list/datatable-pagination';
import { tamPaginaToPageSizeParam } from '@/lib/api/pagination';

export type DiferenciasResumenVariant = 'sucursal' | 'auditoria';

const CONFIG: Record<
  DiferenciasResumenVariant,
  {
    apiPath: string;
    basePath: string;
    title: string;
    periodoLabel: string;
    periodoHint: string;
    emptyMessage: string;
    pdfTitle: string;
    pdfFooter: string;
    pdfFilePrefix: string;
  }
> = {
  sucursal: {
    apiPath: '/api/inventario/diferencias-resumen',
    basePath: '/inventario/diferencias-resumen',
    title: 'Resumen de productos con diferencia',
    periodoLabel: 'Diferencias por control (últimos 60 días)',
    periodoHint:
      'Solo controles de sucursal (inventario diario, ocasional, etc.). Las diferencias de auditoría no se incluyen.',
    emptyMessage: 'No hay productos con diferencias de sucursal en el período seleccionado.',
    pdfTitle: 'Reporte de diferencias de inventario (sucursal)',
    pdfFooter: 'GestionStock - Diferencias sucursal',
    pdfFilePrefix: 'diferencias-resumen',
  },
  auditoria: {
    apiPath: '/api/inventario/diferencias-auditoria',
    basePath: '/inventario/diferencias-auditoria',
    title: 'Diferencias de auditoría',
    periodoLabel: 'Diferencias en controles de auditoría',
    periodoHint:
      'Solo líneas de controles con origen Auditoría (auditoría de stock, ocasional de auditoría, auditoría integral).',
    emptyMessage: 'No hay diferencias de auditoría en el período seleccionado.',
    pdfTitle: 'Reporte de diferencias de auditoría',
    pdfFooter: 'GestionStock - Diferencias auditoría',
    pdfFilePrefix: 'diferencias-auditoria',
  },
};

function rangoDefecto60Dias() {
  const hoy = fechaHoyArgentinaYmd();
  return { desdeActual: ymdAddDays(hoy, -59), hastaActual: hoy };
}

interface ResumenRow {
  detalle_id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  operador: string;
  fecha_control: string;
  control_tipo: string | null;
  control_descripcion: string | null;
  control_origen?: string | null;
  diffCajas: number;
  diffUnidades: number;
}

export default function DiferenciasResumenView({
  variant,
}: {
  variant: DiferenciasResumenVariant;
}) {
  const cfg = CONFIG[variant];
  const searchParams = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<ResumenRow[]>([]);
  const [total, setTotal] = useState(0);
  const [operadoresOpciones, setOperadoresOpciones] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desdeActual, setDesdeActual] = useState('');
  const [hastaActual, setHastaActual] = useState('');
  const [desdeInput, setDesdeInput] = useState('');
  const [hastaInput, setHastaInput] = useState('');
  const [categoriaMacro, setCategoriaMacro] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [puedeConsolidado, setPuedeConsolidado] = useState(false);

  const origenFiltro = searchParams.get('origen') ?? '';
  const tipoFiltro = searchParams.get('tipo') ?? '';
  const operadorFiltro = searchParams.get('operador') ?? '';
  const {
    paginaActual,
    setPaginaActual,
    tamPagina,
    onTamPaginaChange,
  } = usePaginacionServidor([
    searchParams.toString(),
    categoriaMacro,
    busquedaAplicada,
    variant,
    origenFiltro,
    tipoFiltro,
    operadorFiltro,
  ]);
  const totalPaginas = useTotalPaginas(total, tamPagina);
  const tiposOpciones =
    variant === 'auditoria'
      ? TIPOS_INVENTARIO_AUDITORIA_FILTRO
      : origenFiltro === 'auditoria'
        ? TIPOS_INVENTARIO_AUDITORIA_FILTRO
        : origenFiltro === 'todos'
          ? TIPOS_INVENTARIO_FILTRO
          : TIPOS_INVENTARIO_SUCURSAL_FILTRO;

  function buildQs(overrides: Record<string, string>) {
    const qs = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '') qs.delete(k);
      else qs.set(k, v);
    }
    return qs;
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        const perms = json?.data?.permissions as string[] | undefined;
        const rol = json?.data?.rol as string | undefined;
        setPuedeConsolidado(clientHasPermission(perms, rol, 'inventario.diferencias_consolidado'));
      } catch {
        setPuedeConsolidado(false);
      }
    })();
  }, []);

  useEffect(() => {
    const desdeUrl = searchParams.get('desdeActual') ?? '';
    const hastaUrl = searchParams.get('hastaActual') ?? '';

    if (!desdeUrl || !hastaUrl) {
      const def = rangoDefecto60Dias();
      const qs = new URLSearchParams(searchParams.toString());
      qs.set('desdeActual', def.desdeActual);
      qs.set('hastaActual', def.hastaActual);
      router.replace(`${cfg.basePath}?${qs.toString()}`);
      return;
    }

    async function cargar() {
      setLoading(true);
      setError('');
      try {
        const desdeAct = desdeUrl;
        const hastaAct = hastaUrl;
        setDesdeActual(desdeAct);
        setHastaActual(hastaAct);
        setDesdeInput(desdeAct);
        setHastaInput(hastaAct);

        const params = new URLSearchParams({
          desdeActual: desdeAct,
          hastaActual: hastaAct,
        });
        if (categoriaMacro) params.set('categoria_macro', categoriaMacro);
        if (busquedaAplicada.trim()) params.set('busqueda', busquedaAplicada.trim());
        if (variant === 'sucursal' && origenFiltro) params.set('origen', origenFiltro);
        if (tipoFiltro) params.set('tipo', tipoFiltro);
        if (operadorFiltro) params.set('operador', operadorFiltro);
        params.set('page', String(paginaActual));
        params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));

        const res = await fetch(`${cfg.apiPath}?${params.toString()}`);
        const json = (await res.json()) as {
          data?: ResumenRow[];
          total?: number;
          operadores?: string[];
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar diferencias');
          setItems([]);
          setTotal(0);
          return;
        }
        setItems(json.data ?? []);
        setTotal(json.total ?? 0);
        setOperadoresOpciones(json.operadores ?? []);
      } catch {
        setError('Error al cargar diferencias');
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    void cargar();
  }, [
    searchParams,
    categoriaMacro,
    busquedaAplicada,
    router,
    variant,
    origenFiltro,
    tipoFiltro,
    operadorFiltro,
    paginaActual,
    tamPagina,
  ]);

  function aplicarFechas() {
    if (!desdeInput || !hastaInput) {
      setError('Indicá fecha desde y hasta.');
      return;
    }
    if (hastaInput < desdeInput) {
      setError('La fecha "Hasta" no puede ser anterior a "Desde".');
      return;
    }
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('desdeActual', desdeInput);
    qs.set('hastaActual', hastaInput);
    router.push(`${cfg.basePath}?${qs.toString()}`);
  }

  async function exportarPdf() {
    if (total === 0) return;

    const params = new URLSearchParams({
      desdeActual,
      hastaActual,
      page: '1',
      pageSize: 'all',
    });
    if (categoriaMacro) params.set('categoria_macro', categoriaMacro);
    if (busquedaAplicada.trim()) params.set('busqueda', busquedaAplicada.trim());
    if (variant === 'sucursal' && origenFiltro) params.set('origen', origenFiltro);
    if (tipoFiltro) params.set('tipo', tipoFiltro);
    if (operadorFiltro) params.set('operador', operadorFiltro);

    let filasExport = items;
    try {
      const res = await fetch(`${cfg.apiPath}?${params.toString()}`);
      const json = (await res.json()) as { data?: ResumenRow[] };
      if (res.ok && json.data) filasExport = json.data;
    } catch {
      /* usa página actual si falla */
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const fechaGen = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const categoriaLabel = categoriaMacro || 'Todas';

    doc.setFontSize(14);
    doc.text(cfg.pdfTitle, 40, 38);
    doc.setFontSize(10);
    doc.text(`Periodo: ${desdeActual || '-'} a ${hastaActual || '-'}`, 40, 56);
    doc.text(`Categoria macro: ${categoriaLabel}`, 40, 70);
    doc.text(`Generado: ${fechaGen}`, 40, 84);
    doc.text(`Registros: ${filasExport.length}`, 40, 98);

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
        'Control',
        'Operador',
        'Fecha control',
        'Diferencia (cajas)',
        'Diferencia (unid.)',
      ]],
      body: filasExport.map((r) => [
        r.producto_id_sistema,
        r.codigo_barras || '-',
        r.descripcion || '-',
        r.presentacion || '-',
        r.laboratorio || '-',
        r.control_descripcion || r.control_tipo || r.control_id,
        r.operador || '-',
        r.fecha_control ? formatDateTime(r.fecha_control) : '-',
        r.diffCajas.toFixed(0),
        r.diffUnidades.toFixed(0),
      ]),
      didDrawPage: () => {
        const pageSize = doc.internal.pageSize;
        doc.setFontSize(8);
        doc.text(cfg.pdfFooter, 40, pageSize.getHeight() - 18);
      },
    });

    const safeDesde = (desdeActual || 'sin-desde').replace(/[^\d-]/g, '');
    const safeHasta = (hastaActual || 'sin-hasta').replace(/[^\d-]/g, '');
    doc.save(`${cfg.pdfFilePrefix}_${safeDesde}_${safeHasta}.pdf`);
  }

  return (
    <div className={DATATABLE_PAGE_ROOT}>
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
          <h1 className="text-xl font-bold text-gray-900">{cfg.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeConsolidado ? (
            <Link href="/inventario/diferencias-consolidado">
              <Button size="sm" variant="outline">
                Consolidado
              </Button>
            </Link>
          ) : null}
          {variant === 'auditoria' ? (
            <Link href="/inventario/diferencias-resumen">
              <Button size="sm" variant="outline">
                Resumen sucursal
              </Button>
            </Link>
          ) : (
            <Link href="/inventario/diferencias-auditoria">
              <Button size="sm" variant="outline">
                Auditoría
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Card className={DATATABLE_CARD_CLASS}>
        <CardHeader>
          <div className="flex flex-col gap-2 text-sm text-gray-700">
            <div className="flex flex-col gap-1">
              <p className="font-medium">{cfg.periodoLabel}</p>
              <p className="text-xs text-gray-500">
                {cfg.periodoHint} Desde: {desdeActual || '-'} hasta: {hastaActual || '-'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Desde</label>
                <input
                  type="date"
                  value={desdeInput}
                  onChange={(e) => setDesdeInput(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Hasta</label>
                <input
                  type="date"
                  value={hastaInput}
                  onChange={(e) => setHastaInput(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <Button size="sm" variant="secondary" onClick={aplicarFechas} disabled={loading}>
                Aplicar fechas
              </Button>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Categoría macro</label>
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
              {variant === 'sucursal' ? (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Origen</label>
                  <select
                    value={origenFiltro}
                    onChange={(e) =>
                      router.push(`${cfg.basePath}?${buildQs({ origen: e.target.value }).toString()}`)
                    }
                    className="h-8 min-w-[120px] rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {ORIGENES_DIFERENCIA_FILTRO.map((o) => (
                      <option key={o.value || 'all'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Tipo inventario</label>
                <select
                  value={tipoFiltro}
                  onChange={(e) =>
                    router.push(`${cfg.basePath}?${buildQs({ tipo: e.target.value }).toString()}`)
                  }
                  className="h-8 min-w-[150px] rounded-md border border-input bg-background px-2 text-xs"
                >
                  {tiposOpciones.map((t) => (
                    <option key={t.value || 'all'} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Operador</label>
                <select
                  value={operadorFiltro}
                  onChange={(e) =>
                    router.push(`${cfg.basePath}?${buildQs({ operador: e.target.value }).toString()}`)
                  }
                  className="h-8 min-w-[150px] rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Todos</option>
                  {operadoresOpciones.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || total === 0}
                onClick={exportarPdf}
              >
                Exportar PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <DatatableListSection
            busquedaTexto={busquedaAplicada}
            onBusquedaChange={(v) => setBusquedaAplicada(v.trim())}
            tamPagina={tamPagina}
            onTamPaginaChange={onTamPaginaChange}
            paginaActual={paginaActual}
            onPaginaChange={setPaginaActual}
            totalFilas={total}
            searchPlaceholder="Nombre, código, presentación, laboratorio…"
            footerDetalle={`${total} diferencia${total !== 1 ? 's' : ''}`}
            loading={loading}
            error={error || null}
            empty={!loading && !error && total === 0}
            emptyMessage={cfg.emptyMessage}
            mobile={<DiferenciasResumenListMobile items={items} />}
            table={
              <table className="w-full text-sm">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Producto</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Código barras
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Origen</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Tipo</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Diferencia (cajas / unid.)
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Fecha control
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Operador</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((r) => (
                      <tr key={`${r.detalle_id}-${r.control_id}`}>
                        <td className="px-4 py-2 align-middle">
                          <p className="font-medium text-gray-900">{r.descripcion}</p>
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
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-700">
                          {r.control_origen === 'Auditoria'
                            ? 'Auditoría'
                            : r.control_origen === 'Sucursal'
                              ? 'Sucursal'
                              : r.control_origen || '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-700">
                          {r.control_tipo
                            ? etiquetaTipoControlInventario(r.control_tipo as TipoControlInventario)
                            : '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-800">
                          {r.diffCajas > 0 ? '+' : ''}
                          {r.diffCajas.toFixed(0)} / {r.diffUnidades > 0 ? '+' : ''}
                          {r.diffUnidades.toFixed(0)}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-700">
                          {r.fecha_control ? formatDateTime(r.fecha_control) : '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-700">
                          {r.operador || '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-center">
                          <Link
                            href={`/inventario/${r.control_id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ver control
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
