'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  fechaHoyArgentinaYmd,
  ymdAddDays,
  formatDate,
  formatDateForFilename,
  formatDateTime,
  formatNowDateTime,
  formatMoneda,
} from '@/lib/utils';
import { clientHasPermission } from '@/lib/auth/permissions-client';
import {
  ORIGENES_DIFERENCIA_FILTRO,
  TIPOS_INVENTARIO_AUDITORIA_FILTRO,
  TIPOS_INVENTARIO_FILTRO,
  TIPOS_INVENTARIO_SUCURSAL_FILTRO,
} from '@/lib/inventario/diferencias-consolidado-tipos';
import {
  parseOrdenColumnaDiferenciasResumen,
  parseOrdenDirDiferenciasResumen,
  type OrdenColumnaDiferenciasResumen,
  type OrdenDirDiferenciasResumen,
} from '@/lib/inventario/diferencias-resumen-orden';
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
} from '@/components/list/datatable-pagination';
import { tamPaginaToPageSizeParam } from '@/lib/api/pagination';
import {
  CollapsibleFiltrosPanel,
  FiltrosToggleButton,
} from '@/components/list/CollapsibleFiltros';

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
    periodoLabel: 'Diferencias por control',
    periodoHint:
      '',
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
  stockSistCajas?: number;
  stockSistUnidades?: number;
  stockRealCajas?: number;
  stockRealUnidades?: number;
  diffCajas: number;
  diffUnidades: number;
  precio?: number | null;
  monto?: number | null;
  ajustado?: boolean;
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
  const [montoTotal, setMontoTotal] = useState(0);
  const [montoPositivo, setMontoPositivo] = useState(0);
  const [montoNegativo, setMontoNegativo] = useState(0);
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
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const origenFiltro = searchParams.get('origen') ?? '';
  const tipoFiltro = searchParams.get('tipo') ?? '';
  const operadorFiltro = searchParams.get('operador') ?? '';
  /** Por defecto solo diferencias; `solo_diferencias=0` muestra todas las líneas contadas. */
  const soloDiferencias = searchParams.get('solo_diferencias') !== '0';
  const sortBy = parseOrdenColumnaDiferenciasResumen(
    searchParams.get('sortBy') ?? 'fecha_control'
  );
  const sortDir = parseOrdenDirDiferenciasResumen(
    searchParams.get('sortDir') ?? (variant === 'auditoria' ? 'asc' : 'desc')
  );
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
    soloDiferencias,
    sortBy,
    sortDir,
  ]);
  const tituloVista = soloDiferencias
    ? cfg.title
    : variant === 'auditoria'
      ? 'Líneas contadas en auditoría'
      : 'Resumen de productos inventariados';
  const emptyMessage = soloDiferencias
    ? cfg.emptyMessage
    : 'No hay líneas contadas en el período seleccionado.';
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
        if (!soloDiferencias) params.set('solo_diferencias', '0');
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);
        params.set('page', String(paginaActual));
        params.set('pageSize', tamPaginaToPageSizeParam(tamPagina === 'all' ? 'all' : tamPagina));

        const res = await fetch(`${cfg.apiPath}?${params.toString()}`);
        const json = (await res.json()) as {
          data?: ResumenRow[];
          total?: number;
          operadores?: string[];
          montoTotal?: number;
          montoPositivo?: number;
          montoNegativo?: number;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar diferencias');
          setItems([]);
          setTotal(0);
          setMontoTotal(0);
          setMontoPositivo(0);
          setMontoNegativo(0);
          return;
        }
        setItems(json.data ?? []);
        setTotal(json.total ?? 0);
        setMontoTotal(json.montoTotal ?? 0);
        setMontoPositivo(json.montoPositivo ?? 0);
        setMontoNegativo(json.montoNegativo ?? 0);
        setOperadoresOpciones(json.operadores ?? []);
      } catch {
        setError('Error al cargar diferencias');
        setItems([]);
        setMontoTotal(0);
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
    cfg.apiPath,
    cfg.basePath,
    origenFiltro,
    tipoFiltro,
    operadorFiltro,
    soloDiferencias,
    sortBy,
    sortDir,
    paginaActual,
    tamPagina,
  ]);

  function alternarOrden(col: OrdenColumnaDiferenciasResumen) {
    const nextDir: OrdenDirDiferenciasResumen =
      sortBy === col ? (sortDir === 'asc' ? 'desc' : 'asc') : col === 'fecha_control' && variant !== 'auditoria' ? 'desc' : 'asc';
    const qs = buildQs({ sortBy: col, sortDir: nextDir });
    router.push(`${cfg.basePath}?${qs.toString()}`);
  }

  /**
   * Las fechas se aplican solas: no hace falta un botón.
   *
   * Se espera a que el usuario deje de tipear porque un `input[type=date]` emite valores
   * intermedios mientras se escribe el año («0002-01-05»), y recargar con esos sería inútil.
   */
  useEffect(() => {
    if (!desdeInput || !hastaInput) return;
    if (desdeInput === desdeActual && hastaInput === hastaActual) return;

    const t = window.setTimeout(() => {
      // Año incompleto: todavía está escribiendo.
      if (desdeInput < '2000-01-01' || hastaInput < '2000-01-01') return;

      if (hastaInput < desdeInput) {
        setError('La fecha «Hasta» no puede ser anterior a «Desde».');
        return;
      }
      setError('');
      const qs = new URLSearchParams(searchParams.toString());
      qs.set('desdeActual', desdeInput);
      qs.set('hastaActual', hastaInput);
      router.push(`${cfg.basePath}?${qs.toString()}`);
    }, 600);

    return () => window.clearTimeout(t);
  }, [desdeInput, hastaInput, desdeActual, hastaActual, searchParams, router, cfg.basePath]);

  function encabezadoOrdenable(
    col: OrdenColumnaDiferenciasResumen,
    label: string,
    align: 'left' | 'center' = 'center'
  ) {
    const activo = sortBy === col;
    const Icon = activo ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={`px-4 py-2 font-medium text-gray-600 ${
          align === 'left' ? 'text-left' : 'text-center'
        }`}
      >
        <button
          type="button"
          onClick={() => alternarOrden(col)}
          className={`inline-flex items-center gap-0.5 hover:text-gray-900 ${
            align === 'center' ? 'justify-center' : ''
          } ${activo ? 'text-gray-900' : ''}`}
        >
          <span>{label}</span>
          <Icon className={`h-3.5 w-3.5 shrink-0 ${activo ? 'opacity-100' : 'opacity-40'}`} />
        </button>
      </th>
    );
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
    if (!soloDiferencias) params.set('solo_diferencias', '0');
    params.set('sortBy', sortBy);
    params.set('sortDir', sortDir);

    let filasExport = items;
    let montoTotalExport = montoTotal;
    let montoPositivoExport = montoPositivo;
    let montoNegativoExport = montoNegativo;
    try {
      const res = await fetch(`${cfg.apiPath}?${params.toString()}`);
      const json = (await res.json()) as {
        data?: ResumenRow[];
        montoTotal?: number;
        montoPositivo?: number;
        montoNegativo?: number;
      };
      if (res.ok && json.data) filasExport = json.data;
      if (res.ok && json.montoTotal != null) montoTotalExport = json.montoTotal;
      if (res.ok && json.montoPositivo != null) montoPositivoExport = json.montoPositivo;
      if (res.ok && json.montoNegativo != null) montoNegativoExport = json.montoNegativo;
    } catch {
      /* usa página actual si falla */
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const fechaGen = formatNowDateTime();
    const categoriaLabel = categoriaMacro || 'Todas';

    doc.setFontSize(14);
    doc.text(cfg.pdfTitle, 40, 38);
    doc.setFontSize(10);
    doc.text(
      `Periodo: ${formatDate(desdeActual)} a ${formatDate(hastaActual)}`,
      40,
      56
    );
    doc.text(`Categoria macro: ${categoriaLabel}`, 40, 70);
    doc.text(`Generado: ${fechaGen}`, 40, 84);
    doc.text(`Registros: ${filasExport.length}`, 40, 98);
    doc.text(
      `Monto total de diferencias: -${formatMoneda(montoNegativoExport)} / +${formatMoneda(
        montoPositivoExport
      )} / ${formatMoneda(montoTotalExport)}`,
      40,
      112
    );

    autoTable(doc, {
      startY: 126,
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
        'Stock sist. (cajas)',
        'Stock sist. (unid.)',
        'Stock real (cajas)',
        'Stock real (unid.)',
        'Diferencia (cajas)',
        'Diferencia (unid.)',
        'Monto',
        'Ajuste',
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
        String(r.stockSistCajas ?? 0),
        String(r.stockSistUnidades ?? 0),
        String(r.stockRealCajas ?? 0),
        String(r.stockRealUnidades ?? 0),
        r.diffCajas.toFixed(0),
        r.diffUnidades.toFixed(0),
        r.monto != null ? formatMoneda(r.monto) : '-',
        r.ajustado ? 'Ajustado' : 'Pendiente',
      ]),
      didDrawPage: () => {
        const pageSize = doc.internal.pageSize;
        doc.setFontSize(8);
        doc.text(cfg.pdfFooter, 40, pageSize.getHeight() - 18);
      },
    });

    const safeDesde = formatDateForFilename(desdeActual || null);
    const safeHasta = formatDateForFilename(hastaActual || null);
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
          <h1 className="text-xl font-bold text-gray-900">{tituloVista}</h1>
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
        <CardHeader className="shrink-0 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex flex-col gap-1 text-sm text-gray-700">
              <p className="font-medium">{cfg.periodoLabel}</p>
              <p className="text-xs text-gray-500">
                {cfg.periodoHint} Desde: {formatDate(desdeActual)} hasta:{' '}
                {formatDate(hastaActual)}
              </p>
              {!loading && total > 0 ? (
                <p className="text-xs font-medium">
                  Monto total de diferencias:{' '}
                  <span className="text-red-600" title="Faltantes">
                    −{formatMoneda(montoNegativo)}
                  </span>
                  <span className="mx-1 text-gray-400">/</span>
                  <span className="text-green-600" title="Sobrantes">
                    +{formatMoneda(montoPositivo)}
                  </span>
                  <span className="mx-1 text-gray-400">/</span>
                  <span
                    className={
                      montoTotal < 0
                        ? 'text-red-600'
                        : montoTotal > 0
                          ? 'text-green-600'
                          : 'text-gray-700'
                    }
                    title="Neto"
                  >
                    {formatMoneda(montoTotal)}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <FiltrosToggleButton
                abierto={filtrosAbiertos}
                onClick={() => setFiltrosAbiertos((v) => !v)}
                activos={
                  (categoriaMacro ? 1 : 0) +
                  (variant === 'sucursal' && origenFiltro ? 1 : 0) +
                  (tipoFiltro ? 1 : 0) +
                  (operadorFiltro ? 1 : 0) +
                  (!soloDiferencias ? 1 : 0)
                }
              />
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
          <CollapsibleFiltrosPanel
            abierto={filtrosAbiertos}
            onCerrar={() => setFiltrosAbiertos(false)}
            descripcion={cfg.periodoHint}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end">
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
                <label className="text-xs font-medium text-gray-700">Líneas</label>
                <select
                  value={soloDiferencias ? '1' : '0'}
                  onChange={(e) =>
                    router.push(
                      `${cfg.basePath}?${buildQs({
                        solo_diferencias: e.target.value === '1' ? '' : '0',
                      }).toString()}`
                    )
                  }
                  className="h-8 min-w-[180px] rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="1">Solo con diferencias</option>
                  <option value="0">Todas (contadas)</option>
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
            </div>
          </CollapsibleFiltrosPanel>
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
            emptyMessage={emptyMessage}
            mobile={<DiferenciasResumenListMobile items={items} />}
            table={
              <table className="w-full text-sm">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    {encabezadoOrdenable('descripcion', 'Producto', 'left')}
                    {encabezadoOrdenable('codigo_barras', 'Código barras')}
                    {encabezadoOrdenable('control_origen', 'Origen')}
                    {encabezadoOrdenable('control_tipo', 'Tipo')}
                    {encabezadoOrdenable('stock_sist', 'Stock sist. (cajas / unid.)')}
                    {encabezadoOrdenable('stock_real', 'Stock real (cajas / unid.)')}
                    {encabezadoOrdenable('diferencia', 'Diferencia (cajas / unid.)')}
                    {encabezadoOrdenable('monto', 'Monto')}
                    {encabezadoOrdenable('ajustado', 'Ajuste')}
                    {encabezadoOrdenable('fecha_control', 'Fecha control')}
                    {encabezadoOrdenable('operador', 'Operador')}
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
                        <td className="px-4 py-2 align-middle text-center text-xs tabular-nums text-gray-800">
                          {r.stockSistCajas ?? 0} / {r.stockSistUnidades ?? 0}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs tabular-nums text-gray-800">
                          {r.stockRealCajas ?? 0} / {r.stockRealUnidades ?? 0}
                        </td>
                        <td className="px-4 py-2 align-middle text-center text-xs text-gray-800">
                          {r.diffCajas > 0 ? '+' : ''}
                          {r.diffCajas.toFixed(0)} / {r.diffUnidades > 0 ? '+' : ''}
                          {r.diffUnidades.toFixed(0)}
                        </td>
                        <td
                          className={`px-4 py-2 align-middle text-center text-xs font-medium tabular-nums ${
                            r.monto == null
                              ? 'text-gray-400'
                              : r.monto < 0
                                ? 'text-red-600'
                                : r.monto > 0
                                  ? 'text-green-600'
                                  : 'text-gray-700'
                          }`}
                          title={r.precio != null ? `PVP: ${formatMoneda(r.precio)}` : 'PVP no disponible'}
                        >
                          {r.monto != null ? formatMoneda(r.monto) : '—'}
                        </td>
                        <td className="px-4 py-2 align-middle text-center">
                          {r.ajustado ? (
                            <Badge variant="outline">Ajustado</Badge>
                          ) : (
                            <Badge variant="warning">Pendiente</Badge>
                          )}
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
