'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ListTree,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  InformeBajasStockDetalleRow,
  InformeBajasStockFilaSucursal,
  InformeBajasStockTotales,
  InformeBajasStockTrendMes,
  InformeMensualDetalleSucursal,
  InformeMensualDetalleTotales,
  InformeMensualTrendMes,
} from '@/app/api/admin/informe-mensual/route';
import InformeMensualSucursalListMobile from '@/components/admin/InformeMensualSucursalListMobile';
import {
  MESES_CALENDARIO,
  calendarioActualArgentina,
  clampYmNoFuturo,
} from '@/lib/vencimientos-mes-anio-filtro';
import { formatPorcentaje, porcentajeDesdeRatio } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/spinner';
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from 'recharts';

type DiferenciasValorAgregado = {
  valor_positivo: number;
  valor_negativo: number;
  valor_neto: number;
  lineas_con_diferencia: number;
};

interface InformeResp {
  mesSeleccionado: string;
  seleccionMes: {
    mes: string;
    filasSucursal: InformeMensualDetalleSucursal[];
    totales: InformeMensualDetalleTotales;
    diferencias_valor: {
      filasSucursal: Array<
        DiferenciasValorAgregado & { sucursal_id: number; nombrefantasia: string }
      >;
      totales: DiferenciasValorAgregado;
    };
  };
  trends: InformeMensualTrendMes[];
  bajasStock?: {
    disponible: boolean;
    error?: string;
    trends: InformeBajasStockTrendMes[];
    mesSeleccionado: {
      filasSucursal: InformeBajasStockFilaSucursal[];
      totales: InformeBajasStockTrendMes['totales'];
    };
    detalle?: InformeBajasStockDetalleRow[];
    sucursales?: { sucursal_id: number; nombrefantasia: string }[];
  };
  leyenda?: {
    productos_inventariados?: string;
    productos_cargados_vencimientos?: string;
    por_vencer_mes?: string;
    productos_vencidos_mes?: string;
    vencidos_costo?: string;
    vencidos_vendidas_unidades: string;
    inventario_diferencias: string;
    productos_mal_contados?: string;
    inventario_diferencias_valor?: string;
    bajas_stock?: string;
  };
}

type SortKeyTablaSucursal = keyof Pick<
  InformeMensualDetalleSucursal,
  | 'nombrefantasia'
  | 'productos_inventariados'
  | 'productos_con_diferencia'
  | 'productos_mal_contados'
  | 'productos_cargados_vencimientos'
  | 'por_vencer_mes'
  | 'productos_vencidos_mes'
  | 'vencidos_costo'
  | 'unidades_vencidos_vendidas'
>;

type SortDir = 'asc' | 'desc';

function compararFilasSucursal(
  a: InformeMensualDetalleSucursal,
  b: InformeMensualDetalleSucursal,
  key: SortKeyTablaSucursal,
  dir: SortDir
): number {
  let cmp = 0;
  if (key === 'nombrefantasia') {
    cmp = a.nombrefantasia.localeCompare(b.nombrefantasia, 'es', { sensitivity: 'base' });
  } else {
    cmp = Number(a[key]) - Number(b[key]);
  }
  if (cmp === 0 && key !== 'nombrefantasia') {
    cmp = a.nombrefantasia.localeCompare(b.nombrefantasia, 'es', { sensitivity: 'base' });
  }
  return dir === 'asc' ? cmp : -cmp;
}

const MESES_OPTS = [
  { v: '3', l: '3 meses' },
  { v: '6', l: '6 meses' },
  { v: '12', l: '12 meses' },
  { v: '18', l: '18 meses' },
  { v: '24', l: '24 meses' },
];

function valorCsv(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convierte `YYYY-MM` a etiqueta legible, p. ej. `mayo 2026`. */
function formatoMesCorto(ym: string) {
  const [y, m] = ym.trim().split('-');
  const mi = parseInt(m, 10);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  const mes = MESES_CALENDARIO.find((x) => x.value === mi);
  return `${(mes?.label ?? m).toLowerCase()} ${y}`;
}

const BAJAS_CERO: InformeBajasStockTotales = {
  movimientos: 0,
  cajas: 0,
  unidades: 0,
  valor_total: 0,
};

function fmtMoneda(n: number) {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtMonedaCorto(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return fmtMoneda(n);
}

/** Altura interna del gráfico (barras legibles); el viewport se limita con scroll. */
function alturaInternaBarras(filas: number, series: number) {
  const porFila = Math.max(44, series * 14 + 18);
  return Math.max(280, filas * porFila + 72);
}

const GRAFICO_SCROLL_CLASS =
  'w-full max-h-[min(70vh,640px)] overflow-y-auto overflow-x-hidden rounded-md';

const BARRAS_PROPS = {
  barSize: 11,
  maxBarSize: 14,
  radius: [0, 4, 4, 0] as [number, number, number, number],
};

/** Ancho fijo del eje de sucursales (no agrandar el margen). */
const YAXIS_SUCURSAL_WIDTH = 128;

function partirNombreSucursal(nombre: string, maxChars = 14): string[] {
  const words = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let actual = '';
  for (const w of words) {
    const next = actual ? `${actual} ${w}` : w;
    if (next.length <= maxChars) {
      actual = next;
    } else {
      if (actual) lines.push(actual);
      actual = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (actual) lines.push(actual);
  return lines.slice(0, 3);
}

/** Tick del eje Y: tipografía un poco más grande, wrap dentro del mismo ancho. */
function TickNombreSucursal(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const lines = partirNombreSucursal(String(props.payload?.value ?? ''));
  const lineH = 13;
  const startY = y - ((lines.length - 1) * lineH) / 2;
  return (
    <text
      x={x}
      y={startY}
      textAnchor="end"
      fill="currentColor"
      className="fill-gray-700 dark:fill-gray-200"
      style={{ fontSize: 12, fontWeight: 600 }}
    >
      {lines.map((line, i) => (
        <tspan key={`${line}-${i}`} x={x} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function agregarBajasDetalle(
  filas: InformeBajasStockDetalleRow[],
  opts?: { sucursalId?: number; ym?: string }
): InformeBajasStockTotales {
  let acc = { ...BAJAS_CERO };
  for (const r of filas) {
    if (opts?.sucursalId != null && r.sucursal_id !== opts.sucursalId) continue;
    if (opts?.ym != null && r.ym !== opts.ym) continue;
    acc.movimientos += r.movimientos;
    acc.cajas += r.cajas;
    acc.unidades += r.unidades;
    acc.valor_total += r.valor_total;
  }
  return acc;
}

function filasBajasPorSucursalEnMes(
  detalle: InformeBajasStockDetalleRow[],
  ym: string,
  nombreById: Map<number, string>
): InformeBajasStockFilaSucursal[] {
  const porSuc = new Map<number, InformeBajasStockTotales>();
  for (const r of detalle) {
    if (r.ym !== ym) continue;
    const prev = porSuc.get(r.sucursal_id) ?? { ...BAJAS_CERO };
    prev.movimientos += r.movimientos;
    prev.cajas += r.cajas;
    prev.unidades += r.unidades;
    prev.valor_total += r.valor_total;
    porSuc.set(r.sucursal_id, prev);
  }
  return Array.from(porSuc.entries())
    .map(([sucursal_id, t]) => ({
      sucursal_id,
      nombrefantasia: nombreById.get(sucursal_id) ?? `Sucursal ${sucursal_id}`,
      ...t,
    }))
    .sort((a, b) => b.movimientos - a.movimientos || a.nombrefantasia.localeCompare(b.nombrefantasia, 'es'));
}

export default function InformeMensualPage() {
  const router = useRouter();
  const [mes, setMes] = useState('');
  const [mesesTrend, setMesesTrend] = useState('6');
  const [bajasSucursalFiltro, setBajasSucursalFiltro] = useState('');
  const [mesBajasBarras, setMesBajasBarras] = useState('');
  const [payload, setPayload] = useState<InformeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKeyTabla, setSortKeyTabla] = useState<SortKeyTablaSucursal>('nombrefantasia');
  const [sortDirTabla, setSortDirTabla] = useState<SortDir>('asc');

  function alternarOrdenTabla(key: SortKeyTablaSucursal) {
    if (sortKeyTabla === key) {
      setSortDirTabla((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKeyTabla(key);
    setSortDirTabla(key === 'nombrefantasia' ? 'asc' : 'desc');
  }

  useEffect(() => {
    const max = calendarioActualArgentina().ym;
    setMes((prev) => clampYmNoFuturo(prev || max, max));
  }, []);

  const mesMaximoYm = calendarioActualArgentina().ym;
  const cargar = useCallback(async () => {
    const m = mes.trim();
    if (!m) return;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ mes: m, mesesTrend });
      const res = await fetch(`/api/admin/informe-mensual?${q.toString()}`);
      const json = (await res.json()) as InformeResp & {
        error?: string;
        detalle?: string;
        ayuda?: string;
      };

      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const partes = [json.error, json.detalle, json.ayuda].filter(Boolean);
        setError(partes.join('\n\n') || 'No se pudo cargar el informe');
        setPayload(null);
        return;
      }
      setPayload(json);
    } catch {
      setError('Error de red al cargar el informe');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [mes, mesesTrend, router]);

  useEffect(() => {
    if (!mes) return;
    void cargar();
  }, [mes, mesesTrend, cargar]);

  useEffect(() => {
    if (!payload?.mesSeleccionado) return;
    setMesBajasBarras(clampYmNoFuturo(payload.mesSeleccionado, mesMaximoYm));
  }, [payload?.mesSeleccionado, mesMaximoYm]);

  const bajasNombreById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of payload?.bajasStock?.sucursales ?? []) {
      map.set(s.sucursal_id, s.nombrefantasia);
    }
    return map;
  }, [payload?.bajasStock?.sucursales]);

  const filasSucursalOrdenadas = useMemo(() => {
    const filas = [...(payload?.seleccionMes?.filasSucursal ?? [])];
    filas.sort((a, b) => compararFilasSucursal(a, b, sortKeyTabla, sortDirTabla));
    return filas;
  }, [payload?.seleccionMes?.filasSucursal, sortKeyTabla, sortDirTabla]);

  const nombreArchivoBase = payload?.mesSeleccionado
    ? `informe-mensual-sucursales-${payload.mesSeleccionado}`
    : 'informe-mensual-sucursales';

  const exportarExcelTabla = useCallback(() => {
    const sel = payload?.seleccionMes;
    if (!sel?.filasSucursal?.length) return;

    const headers = [
      'Sucursal',
      'Invent. mes',
      'Con dif.',
      'Mal contados',
      'Venc. carg.',
      'P. vencer mes',
      'Vencidos mes',
      'Costo venc.',
      'Vendidos',
    ];
    const rows = filasSucursalOrdenadas.map((r) => [
      r.nombrefantasia,
      r.total_base_trimestre > 0
        ? `${r.inventariados_padron_trimestre}/${r.total_base_trimestre} (${formatPorcentaje(r.porcentaje_inventariados_sobre_base)}%)`
        : String(r.inventariados_padron_trimestre),
      r.productos_con_diferencia,
      r.productos_mal_contados,
      r.productos_cargados_vencimientos,
      r.por_vencer_mes,
      r.productos_vencidos_mes,
      r.vencidos_costo,
      Number(r.unidades_vencidos_vendidas),
    ]);
    const totalRow = [
      'Totales',
      sel.totales.total_base_trimestre > 0
        ? `${sel.totales.inventariados_padron_trimestre}/${sel.totales.total_base_trimestre} (${formatPorcentaje(sel.totales.porcentaje_inventariados_sobre_base)}%)`
        : String(sel.totales.inventariados_padron_trimestre),
      sel.totales.productos_con_diferencia,
      sel.totales.productos_mal_contados,
      sel.totales.productos_cargados_vencimientos,
      sel.totales.por_vencer_mes,
      sel.totales.productos_vencidos_mes,
      sel.totales.vencidos_costo,
      Number(sel.totales.unidades_vencidos_vendidas),
    ];

    const csv = [headers, ...rows, totalRow]
      .map((row) => row.map((cell) => valorCsv(cell)).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombreArchivoBase}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [filasSucursalOrdenadas, nombreArchivoBase, payload?.seleccionMes]);

  const exportarPdfTabla = useCallback(() => {
    const sel = payload?.seleccionMes;
    const ym = payload?.mesSeleccionado;
    if (!sel?.filasSucursal?.length || !ym) return;

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(11);
    doc.text(`Informe mensual por sucursal — ${formatoMesCorto(ym)}`, 14, 12);

    const fmtV = (n: number) =>
      n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    autoTable(doc, {
      startY: 16,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [
        ['Sucursal', 'Invent.', 'Con dif.', 'Mal cont.', 'Venc.carg.', 'P.vencer', 'Vencidos', 'Costo', 'Vend.'],
      ],
      body: filasSucursalOrdenadas.map((r) => [
        r.nombrefantasia,
        r.total_base_trimestre > 0
          ? `${r.inventariados_padron_trimestre}/${r.total_base_trimestre} (${formatPorcentaje(r.porcentaje_inventariados_sobre_base)}%)`
          : String(r.inventariados_padron_trimestre),
        String(r.productos_con_diferencia),
        String(r.productos_mal_contados),
        String(r.productos_cargados_vencimientos),
        String(r.por_vencer_mes),
        String(r.productos_vencidos_mes),
        fmtMoneda(r.vencidos_costo),
        fmtV(Number(r.unidades_vencidos_vendidas)),
      ]),
      foot: [
        [
          'Totales',
          sel.totales.total_base_trimestre > 0
            ? `${sel.totales.inventariados_padron_trimestre}/${sel.totales.total_base_trimestre} (${formatPorcentaje(sel.totales.porcentaje_inventariados_sobre_base)}%)`
            : String(sel.totales.inventariados_padron_trimestre),
          String(sel.totales.productos_con_diferencia),
          String(sel.totales.productos_mal_contados),
          String(sel.totales.productos_cargados_vencimientos),
          String(sel.totales.por_vencer_mes),
          String(sel.totales.productos_vencidos_mes),
          fmtMoneda(sel.totales.vencidos_costo),
          fmtV(Number(sel.totales.unidades_vencidos_vendidas)),
        ],
      ],
      showFoot: 'lastPage',
    });

    doc.save(`${nombreArchivoBase}.pdf`);
  }, [filasSucursalOrdenadas, nombreArchivoBase, payload?.mesSeleccionado, payload?.seleccionMes]);

  const serieTendencias = useMemo(() => {
    if (!payload?.trends?.length) return [];
    return payload.trends.map((t) => ({
      mesEtiqueta: formatoMesCorto(t.mes),
      mes: t.mes,
      cargados: t.totales.vencidos_cargados,
      vendidas: Number(t.totales.vencidos_vendidas_unidades),
      difInventario: t.totales.inventario_lineas_con_diferencia,
    }));
  }, [payload]);

  const serieDifValorTendencia = useMemo(() => {
    if (!payload?.trends?.length) return [];
    return payload.trends.map((t) => ({
      mesEtiqueta: formatoMesCorto(t.mes),
      mes: t.mes,
      valorPositivo: t.diferencias_valor?.valor_positivo ?? 0,
      valorNegativo: t.diferencias_valor?.valor_negativo ?? 0,
      valorNeto:
        (t.diferencias_valor?.valor_positivo ?? 0) - (t.diferencias_valor?.valor_negativo ?? 0),
    }));
  }, [payload]);

  const serieDifValorSucursal = useMemo(() => {
    const filas = payload?.seleccionMes?.diferencias_valor?.filasSucursal ?? [];
    return filas.map((s) => ({
      nombre:
        s.nombrefantasia.length > 26 ? `${s.nombrefantasia.slice(0, 26)}…` : s.nombrefantasia,
      valorPositivo: s.valor_positivo,
      valorNegativo: s.valor_negativo,
      valorNeto: s.valor_positivo - s.valor_negativo,
    }));
  }, [payload]);

  const totalesDifValorMes = payload?.seleccionMes?.diferencias_valor?.totales;
  const netoDifValorMes =
    (totalesDifValorMes?.valor_positivo ?? 0) - (totalesDifValorMes?.valor_negativo ?? 0);

  const bajasValorPorSucursalMes = useMemo(() => {
    const map = new Map<number, number>();
    const bs = payload?.bajasStock;
    const ym = payload?.mesSeleccionado;
    if (!bs?.disponible || !ym) return map;
    const filas =
      bs.detalle?.length && ym
        ? filasBajasPorSucursalEnMes(bs.detalle, ym, bajasNombreById)
        : ym === payload.mesSeleccionado
          ? bs.mesSeleccionado.filasSucursal
          : [];
    for (const f of filas) {
      map.set(f.sucursal_id, f.valor_total);
    }
    return map;
  }, [payload, bajasNombreById]);

  const muestraValorBajas = Boolean(payload?.bajasStock?.disponible);

  const serieSucursales = useMemo(() => {
    if (!payload?.seleccionMes?.filasSucursal) return [];
    return payload.seleccionMes.filasSucursal.map((s) => ({
      nombre: s.nombrefantasia.length > 26 ? `${s.nombrefantasia.slice(0, 26)}…` : s.nombrefantasia,
      cargados: s.productos_cargados_vencimientos,
      vendidas: Number(s.unidades_vencidos_vendidas),
      difInventario: s.productos_con_diferencia,
      valorBajas: bajasValorPorSucursalMes.get(s.sucursal_id) ?? 0,
    }));
  }, [payload, bajasValorPorSucursalMes]);

  const serieBajasTendencia = useMemo(() => {
    const bs = payload?.bajasStock;
    if (!bs?.disponible) return [];
    const sid = bajasSucursalFiltro ? Number(bajasSucursalFiltro) : null;
    const detalle = bs.detalle ?? [];
    return bs.trends.map((t) => {
      const totales =
        sid != null && Number.isFinite(sid) && detalle.length > 0
          ? agregarBajasDetalle(detalle, { sucursalId: sid, ym: t.mes })
          : t.totales;
      return {
        mesEtiqueta: formatoMesCorto(t.mes),
        mes: t.mes,
        movimientos: totales.movimientos,
        cajas: totales.cajas,
        unidades: totales.unidades,
        valorTotal: totales.valor_total,
      };
    });
  }, [payload, bajasSucursalFiltro]);

  const totalesBajasMesBarras = useMemo(() => {
    const bs = payload?.bajasStock;
    if (!bs?.disponible) return BAJAS_CERO;
    const ym = mesBajasBarras.trim() || payload?.mesSeleccionado || '';
    if (bs.detalle?.length && ym) {
      return agregarBajasDetalle(bs.detalle, { ym });
    }
    return bs.mesSeleccionado.totales;
  }, [payload, mesBajasBarras]);

  const rangoMesesBajas = useMemo(() => {
    const trends = payload?.bajasStock?.trends;
    if (!trends?.length) {
      return { min: undefined as string | undefined, max: mesMaximoYm ?? undefined };
    }
    return {
      min: trends[0].mes,
      max: mesMaximoYm && trends[trends.length - 1].mes > mesMaximoYm
        ? mesMaximoYm
        : trends[trends.length - 1].mes,
    };
  }, [payload?.bajasStock?.trends, mesMaximoYm]);

  const serieBajasSucursales = useMemo(() => {
    const bs = payload?.bajasStock;
    if (!bs?.disponible) return [];
    const ym = mesBajasBarras.trim() || payload?.mesSeleccionado || '';
    const filas =
      bs.detalle?.length && ym
        ? filasBajasPorSucursalEnMes(bs.detalle, ym, bajasNombreById)
        : ym === payload?.mesSeleccionado
          ? bs.mesSeleccionado.filasSucursal
          : [];
    return filas.map((s) => ({
      nombre: s.nombrefantasia.length > 26 ? `${s.nombrefantasia.slice(0, 26)}…` : s.nombrefantasia,
      movimientos: s.movimientos,
      cajas: s.cajas,
      unidades: s.unidades,
      valorTotal: s.valor_total,
    }));
  }, [payload, mesBajasBarras, bajasNombreById]);

  function encabezadoOrdenableTabla(
    key: SortKeyTablaSucursal,
    label: string,
    align: 'left' | 'right' = 'left'
  ) {
    const activo = sortKeyTabla === key;
    const Icon = activo ? (sortDirTabla === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={`px-2 py-2 align-bottom ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => alternarOrdenTabla(key)}
          className={`inline-flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide lg:text-xs ${
            align === 'right' ? 'justify-end' : 'justify-start'
          } ${activo ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
        >
          <span className="whitespace-normal">{label}</span>
          <Icon className={`h-3 w-3 shrink-0 ${activo ? 'opacity-100' : 'opacity-40'}`} />
        </button>
      </th>
    );
  }

  function celdaInventariadosMes(row: InformeMensualDetalleSucursal) {
    if (row.total_base_trimestre <= 0) {
      return <span className="tabular-nums">{row.inventariados_padron_trimestre}</span>;
    }
    return (
      <span className="inline-flex flex-col items-end leading-tight tabular-nums">
        <span>
          {row.inventariados_padron_trimestre}/{row.total_base_trimestre}
        </span>
        <span className="text-[10px] font-normal text-gray-500 dark:text-gray-400">
          ({formatPorcentaje(row.porcentaje_inventariados_sobre_base)}%)
        </span>
      </span>
    );
  }

  function celdaDiferencia(conDif: number, inventariados: number) {
    if (inventariados <= 0) {
      return <span className="tabular-nums">{conDif}</span>;
    }
    const pct = formatPorcentaje(porcentajeDesdeRatio(conDif, inventariados));
    return (
      <span className="inline-flex flex-col items-end leading-tight tabular-nums">
        <span>{conDif}</span>
        <span className="text-[10px] font-normal text-gray-500 dark:text-gray-400">({pct}%)</span>
      </span>
    );
  }

  const difLineasMes = payload?.seleccionMes.totales.inventario_lineas_con_diferencia ?? 0;
  const inventariadosTotalMes = payload?.seleccionMes.totales.productos_inventariados ?? 0;

  if (!mes && !loading) {
    return <PageSpinner />;
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            aria-label="Volver"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Informe mensual por sucursal
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Vencidos cargados, unidades vendidas desde vencimientos y líneas con diferencias de
              inventario en el período cerrado cada mes.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="mes-inf" className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Mes
            </label>
            <input
              id="mes-inf"
              type="month"
              value={mes}
              max={mesMaximoYm ?? undefined}
              onChange={(e) =>
                setMes(clampYmNoFuturo(e.target.value, mesMaximoYm))
              }
              className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="trend-span" className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Tendencia en los últimos
            </label>
            <select
              id="trend-span"
              value={mesesTrend}
              onChange={(e) => setMesesTrend(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              {MESES_OPTS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && <PageSpinner />}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-left dark:border-red-900 dark:bg-red-950">
          <p className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!loading && payload && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Vencidos cargados
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                  {payload.seleccionMes.totales.productos_cargados_vencimientos.toLocaleString(
                    'es-AR',
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Unidades vendidas (vencimientos)
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                  {Number(
                    payload.seleccionMes.totales.unidades_vencidos_vendidas,
                  ).toLocaleString('es-AR', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Líneas con diferencia (inventarios)
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                  {(
                    payload.seleccionMes.totales.inventariados_padron_trimestre ??
                    inventariadosTotalMes
                  ).toLocaleString('es-AR')}
                  <span className="mx-1.5 font-semibold text-gray-400 dark:text-gray-500">/</span>
                  {difLineasMes.toLocaleString('es-AR')}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Avance padrón trim. / líneas con diferencia (mes)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Diferencias inventario en cajas (valor neto cadena)
                </h3>
              </CardHeader>
              <CardContent>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    netoDifValorMes < 0
                      ? 'text-red-700 dark:text-red-400'
                      : netoDifValorMes > 0
                        ? 'text-violet-700 dark:text-violet-400'
                        : 'text-gray-900 dark:text-gray-50'
                  }`}
                >
                  {fmtMoneda(netoDifValorMes)}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  +{fmtMoneda(totalesDifValorMes?.valor_positivo ?? 0)} / −
                  {fmtMoneda(totalesDifValorMes?.valor_negativo ?? 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden />
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Totales cadena — tendencia{' '}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    ({formatoMesCorto(serieTendencias[0]?.mes ?? '')}{' '}
                    → {formatoMesCorto(serieTendencias[serieTendencias.length - 1]?.mes ?? '')})
                  </span>
                </h3>
              </div>
            </CardHeader>
            <CardContent className="h-[320px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieTendencias} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis dataKey="mesEtiqueta" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8 }}
                    formatter={(value, name) => {
                      const raw = value ?? 0;
                      const n = typeof raw === 'number' ? raw : Number(raw);
                      const label =
                        name === 'cargados'
                          ? 'Cargados'
                          : name === 'vendidas'
                            ? 'Vendidas'
                            : 'Dif. invent.';
                      const pretty =
                        name === 'vendidas'
                          ? n.toLocaleString('es-AR', {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            })
                          : n.toLocaleString('es-AR');
                      return [pretty, label];
                    }}
                    labelFormatter={(_, payloadItems) =>
                      formatoMesCorto(
                        (payloadItems?.[0]?.payload as { mes?: string } | undefined)?.mes ?? '',
                      )
                    }
                  />
                  <Legend
                    formatter={(value) =>
                      value === 'cargados'
                        ? 'Vencidos cargados'
                        : value === 'vendidas'
                          ? 'Unid. vendidas'
                          : 'Líneas con dif.'
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="cargados"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="vendidas"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="difInventario"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Diferencias de inventario en cajas — valor (cadena) — tendencia{' '}
                    <span className="font-normal text-gray-500 dark:text-gray-400">
                      neto = positivo − negativo
                    </span>
                  </h3>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    router.push(
                      `/admin/informe-mensual/diferencias-cajas?mes=${encodeURIComponent(payload.mesSeleccionado)}`,
                    )
                  }
                >
                  <ListTree className="mr-1.5 h-4 w-4" aria-hidden />
                  Detalle por cajas
                </Button>
              </div>
            </CardHeader>
            <CardContent className="h-[320px] w-full pt-2">
              {serieDifValorTendencia.length === 0 ? (
                <p className="text-sm text-gray-500">Sin datos en el período.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={serieDifValorTendencia} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                    <XAxis dataKey="mesEtiqueta" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => fmtMonedaCorto(Number(v))}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8 }}
                      formatter={(value, name) => {
                        const n = Number(value ?? 0);
                        const label =
                          name === 'valorPositivo'
                            ? 'Valor positivo'
                            : name === 'valorNegativo'
                              ? 'Valor negativo'
                              : 'Valor neto';
                        return [fmtMoneda(n), label];
                      }}
                      labelFormatter={(_, items) =>
                        formatoMesCorto(
                          (items?.[0]?.payload as { mes?: string } | undefined)?.mes ?? '',
                        )
                      }
                    />
                    <Legend
                      formatter={(value) =>
                        value === 'valorPositivo'
                          ? 'Dif. positiva ($)'
                          : value === 'valorNegativo'
                            ? 'Dif. negativa ($)'
                            : 'Neto ($)'
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="valorPositivo"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="valorNegativo"
                      stroke="#dc2626"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="valorNeto"
                      stroke="#d97706"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Diferencias de inventario en cajas — valor por sucursal (
                    {formatoMesCorto(payload.mesSeleccionado)})
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Δ cajas × costo por caja (sin unidades sueltas).
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    router.push(
                      `/admin/informe-mensual/diferencias-cajas?mes=${encodeURIComponent(payload.mesSeleccionado)}`,
                    )
                  }
                >
                  <ListTree className="mr-1.5 h-4 w-4" aria-hidden />
                  Detalle por cajas
                </Button>
              </div>
            </CardHeader>
            <CardContent className="w-full">
              {serieDifValorSucursal.length === 0 ? (
                <p className="text-sm text-gray-500">Sin diferencias con valor en este mes.</p>
              ) : (
                <div className={GRAFICO_SCROLL_CLASS}>
                  <div
                    className="w-full"
                    style={{
                      height: alturaInternaBarras(serieDifValorSucursal.length, 3),
                    }}
                  >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={serieDifValorSucursal}
                      layout="vertical"
                      margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                      barCategoryGap={10}
                      barGap={3}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal
                        className="stroke-gray-200 dark:stroke-gray-700"
                      />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => fmtMonedaCorto(Number(v))}
                      />
                      <YAxis
                        type="category"
                        dataKey="nombre"
                        width={YAXIS_SUCURSAL_WIDTH}
                        tick={<TickNombreSucursal />}
                        interval={0}
                      />
                      <Tooltip
                        formatter={(val, name) => {
                          const n = Number(val ?? 0);
                          const label =
                            name === 'valorPositivo'
                              ? 'Valor positivo'
                              : name === 'valorNegativo'
                                ? 'Valor negativo'
                                : 'Valor neto';
                          return [fmtMoneda(n), label];
                        }}
                      />
                      <Legend
                        formatter={(value) =>
                          value === 'valorPositivo'
                            ? 'Dif. positiva ($)'
                            : value === 'valorNegativo'
                              ? 'Dif. negativa ($)'
                              : 'Neto ($)'
                        }
                      />
                      <Bar dataKey="valorPositivo" fill="#7c3aed" {...BARRAS_PROPS} />
                      <Bar dataKey="valorNegativo" fill="#dc2626" {...BARRAS_PROPS} />
                      <Bar dataKey="valorNeto" fill="#d97706" {...BARRAS_PROPS} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {payload.bajasStock && !payload.bajasStock.disponible && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              No se pudieron cargar las bajas de stock desde onze_center
              {payload.bajasStock.error ? `: ${payload.bajasStock.error}` : '.'}
            </div>
          )}

          {payload.bajasStock?.disponible && (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Totales de bajas para{' '}
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {formatoMesCorto(mesBajasBarras || payload.mesSeleccionado)}
                </span>
                {mesBajasBarras && mesBajasBarras !== payload.mesSeleccionado
                  ? ' (puede diferir del mes principal del informe)'
                  : ''}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Bajas de stock (movimientos)
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                      {totalesBajasMesBarras.movimientos.toLocaleString('es-AR')}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Bajas — cajas (abs.)
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                      {totalesBajasMesBarras.cajas.toLocaleString('es-AR')}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Bajas — unidades (abs.)
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                      {totalesBajasMesBarras.unidades.toLocaleString('es-AR')}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Valor total bajas
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-teal-800 dark:text-teal-300">
                      {fmtMoneda(totalesBajasMesBarras.valor_total)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      ABS(Cantidad) × Costo (medicamentos)
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-hidden />
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        Bajas de stock (onze_center) — tendencia{' '}
                        <span className="font-normal text-gray-500 dark:text-gray-400">
                          Referencia «Baja de Stock»
                        </span>
                      </h3>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="bajas-sucursal-trend"
                        className="text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        Sucursal
                      </label>
                      <select
                        id="bajas-sucursal-trend"
                        value={bajasSucursalFiltro}
                        onChange={(e) => setBajasSucursalFiltro(e.target.value)}
                        className="h-9 min-w-[12rem] rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      >
                        <option value="">Todas las sucursales</option>
                        {(payload.bajasStock.sucursales ?? []).map((s) => (
                          <option key={s.sucursal_id} value={String(s.sucursal_id)}>
                            {s.nombrefantasia}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="h-[320px] w-full pt-2">
                  {serieBajasTendencia.length === 0 ? (
                    <p className="text-sm text-gray-500">Sin movimientos en el período.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={serieBajasTendencia} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                        <XAxis dataKey="mesEtiqueta" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="qty" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis
                          yAxisId="money"
                          orientation="right"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v) => fmtMonedaCorto(Number(v))}
                        />
                        <Tooltip
                          contentStyle={{ borderRadius: 8 }}
                          formatter={(value, name) => {
                            const n = Number(value ?? 0);
                            if (name === 'valorTotal') {
                              return [fmtMoneda(n), 'Valor total'];
                            }
                            const label =
                              name === 'movimientos'
                                ? 'Movimientos'
                                : name === 'cajas'
                                  ? 'Cajas (abs.)'
                                  : 'Unid. (abs.)';
                            return [n.toLocaleString('es-AR'), label];
                          }}
                          labelFormatter={(_, items) =>
                            formatoMesCorto(
                              (items?.[0]?.payload as { mes?: string } | undefined)?.mes ?? '',
                            )
                          }
                        />
                        <Legend
                          formatter={(value) =>
                            value === 'movimientos'
                              ? 'Movimientos'
                              : value === 'cajas'
                                ? 'Cajas (abs.)'
                                : value === 'valorTotal'
                                  ? 'Valor total'
                                  : 'Unid. (abs.)'
                          }
                        />
                        <Line
                          yAxisId="qty"
                          type="monotone"
                          dataKey="movimientos"
                          stroke="#e11d48"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          yAxisId="qty"
                          type="monotone"
                          dataKey="cajas"
                          stroke="#7c3aed"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          yAxisId="qty"
                          type="monotone"
                          dataKey="unidades"
                          stroke="#64748b"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          yAxisId="money"
                          type="monotone"
                          dataKey="valorTotal"
                          stroke="#0d9488"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      Bajas de stock por sucursal
                    </h3>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="bajas-mes-barras"
                        className="text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        Mes y año
                      </label>
                      <input
                        id="bajas-mes-barras"
                        type="month"
                        value={mesBajasBarras}
                        min={rangoMesesBajas.min}
                        max={rangoMesesBajas.max}
                        onChange={(e) =>
                          setMesBajasBarras(clampYmNoFuturo(e.target.value, mesMaximoYm))
                        }
                        className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="w-full">
                  {serieBajasSucursales.length === 0 ? (
                    <p className="text-sm text-gray-500">Sin bajas de stock en este mes.</p>
                  ) : (
                    <div className={GRAFICO_SCROLL_CLASS}>
                      <div
                        className="w-full"
                        style={{
                          height: alturaInternaBarras(serieBajasSucursales.length, 4),
                        }}
                      >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={serieBajasSucursales}
                          layout="vertical"
                          margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                          barCategoryGap={10}
                          barGap={3}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            horizontal
                            className="stroke-gray-200 dark:stroke-gray-700"
                          />
                          <XAxis
                            xAxisId="qty"
                            type="number"
                            tick={{ fontSize: 11 }}
                            allowDecimals={false}
                          />
                          <XAxis
                            xAxisId="money"
                            type="number"
                            orientation="top"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v) => fmtMonedaCorto(Number(v))}
                          />
                          <YAxis
                            type="category"
                            dataKey="nombre"
                            width={YAXIS_SUCURSAL_WIDTH}
                            tick={<TickNombreSucursal />}
                            interval={0}
                          />
                          <Tooltip
                            formatter={(val, name) => {
                              const n = Number(val ?? 0);
                              if (name === 'valorTotal') return [fmtMoneda(n), 'Valor total'];
                              return [n.toLocaleString('es-AR'), name === 'movimientos' ? 'Movimientos' : name === 'cajas' ? 'Cajas (abs.)' : 'Unid. (abs.)'];
                            }}
                          />
                          <Legend
                            formatter={(value) =>
                              value === 'movimientos'
                                ? 'Movimientos'
                                : value === 'cajas'
                                  ? 'Cajas (abs.)'
                                  : value === 'valorTotal'
                                    ? 'Valor total'
                                    : 'Unid. (abs.)'
                            }
                          />
                          <Bar xAxisId="qty" dataKey="movimientos" fill="#e11d48" {...BARRAS_PROPS} />
                          <Bar xAxisId="qty" dataKey="cajas" fill="#7c3aed" {...BARRAS_PROPS} />
                          <Bar xAxisId="qty" dataKey="unidades" fill="#64748b" {...BARRAS_PROPS} />
                          <Bar xAxisId="money" dataKey="valorTotal" fill="#0d9488" {...BARRAS_PROPS} />
                        </BarChart>
                      </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Por sucursal — mes {formatoMesCorto(payload.mesSeleccionado)}
              </h3>
              {muestraValorBajas && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Incluye valor total de bajas de stock (ABS(Cantidad) × Costo) del mismo mes.
                </p>
              )}
            </CardHeader>
            <CardContent className="w-full">
              <div className={GRAFICO_SCROLL_CLASS}>
                <div
                  className="w-full"
                  style={{
                    height: alturaInternaBarras(
                      serieSucursales.length,
                      muestraValorBajas ? 4 : 3
                    ),
                  }}
                >
                <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={serieSucursales}
                  layout="vertical"
                  margin={{ top: muestraValorBajas ? 28 : 8, right: 16, left: 8, bottom: 8 }}
                  barCategoryGap={10}
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis xAxisId="qty" type="number" tick={{ fontSize: 11 }} allowDecimals />
                  {muestraValorBajas && (
                    <XAxis
                      xAxisId="money"
                      type="number"
                      orientation="top"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => fmtMonedaCorto(Number(v))}
                    />
                  )}
                  <YAxis
                    type="category"
                    dataKey="nombre"
                    width={YAXIS_SUCURSAL_WIDTH}
                    tick={<TickNombreSucursal />}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(val, name) => {
                      const n = Number(val ?? 0);
                      if (name === 'valorBajas') return [fmtMoneda(n), 'Valor bajas'];
                      if (name === 'vendidas') {
                        return [
                          n.toLocaleString('es-AR', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          }),
                          'Unid. vendidas',
                        ];
                      }
                      return [
                        n.toLocaleString('es-AR'),
                        name === 'cargados' ? 'Vencidos carg.' : 'Dif. invent.',
                      ];
                    }}
                  />
                  <Legend
                    formatter={(value) =>
                      value === 'cargados'
                        ? 'Vencidos carg.'
                        : value === 'vendidas'
                          ? 'Unid. vendidas'
                          : value === 'valorBajas'
                            ? 'Valor bajas'
                            : 'Dif. invent.'
                    }
                  />
                  <Bar xAxisId="qty" dataKey="cargados" fill="#2563eb" {...BARRAS_PROPS} />
                  <Bar xAxisId="qty" dataKey="vendidas" fill="#16a34a" {...BARRAS_PROPS} />
                  <Bar xAxisId="qty" dataKey="difInventario" fill="#d97706" {...BARRAS_PROPS} />
                  {muestraValorBajas && (
                    <Bar xAxisId="money" dataKey="valorBajas" fill="#0d9488" {...BARRAS_PROPS} />
                  )}
                </BarChart>
              </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                Detalle por sucursal — {formatoMesCorto(payload.mesSeleccionado)}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportarExcelTabla}
                  disabled={!payload?.seleccionMes?.filasSucursal?.length}
                >
                  Excel (CSV)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportarPdfTabla}
                  disabled={!payload?.seleccionMes?.filasSucursal?.length}
                >
                  PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filasSucursalOrdenadas.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-400">
                  No hay sucursales con datos para el mes seleccionado.
                </p>
              ) : (
                <>
                  <div className="md:hidden">
                    <InformeMensualSucursalListMobile rows={filasSucursalOrdenadas} />
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[800px] table-fixed text-xs lg:text-sm">
                      <colgroup>
                        <col className="w-[16%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[11%]" />
                        <col className="w-[8%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400 lg:text-xs">
                          {encabezadoOrdenableTabla('nombrefantasia', 'Sucursal')}
                          {encabezadoOrdenableTabla('productos_inventariados', 'Avance trim.', 'right')}
                          {encabezadoOrdenableTabla('productos_con_diferencia', 'Con dif.', 'right')}
                          {encabezadoOrdenableTabla('productos_mal_contados', 'Mal contados', 'right')}
                          {encabezadoOrdenableTabla(
                            'productos_cargados_vencimientos',
                            'Venc. carg.',
                            'right'
                          )}
                          {encabezadoOrdenableTabla('por_vencer_mes', 'P. vencer', 'right')}
                          {encabezadoOrdenableTabla('productos_vencidos_mes', 'Vencidos', 'right')}
                          {encabezadoOrdenableTabla('vencidos_costo', 'Costo venc.', 'right')}
                          {encabezadoOrdenableTabla(
                            'unidades_vencidos_vendidas',
                            'Vendidos',
                            'right'
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {filasSucursalOrdenadas.map((row) => (
                          <tr
                            key={row.sucursal_id}
                            className="hover:bg-gray-50/80 dark:hover:bg-gray-900/40"
                          >
                            <td className="px-2 py-2.5 align-top">
                              <p
                                className="truncate font-medium text-gray-900 dark:text-gray-100"
                                title={row.nombrefantasia}
                              >
                                {row.nombrefantasia}
                              </p>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top text-gray-700 dark:text-gray-200">
                              {celdaInventariadosMes(row)}
                            </td>
                            <td className="px-2 py-2.5 text-right align-top">
                              <span
                                className={
                                  row.productos_con_diferencia > 0
                                    ? 'font-medium text-violet-700 dark:text-violet-400'
                                    : 'text-gray-500'
                                }
                              >
                                {celdaDiferencia(
                                  row.productos_con_diferencia,
                                  row.productos_inventariados
                                )}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums">
                              <span
                                className={
                                  row.productos_mal_contados > 0
                                    ? 'font-medium text-violet-700 dark:text-violet-400'
                                    : 'text-gray-500'
                                }
                              >
                                {row.productos_mal_contados}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-700 dark:text-gray-200">
                              {row.productos_cargados_vencimientos}
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums">
                              <span
                                className={
                                  row.por_vencer_mes > 0
                                    ? 'font-semibold text-amber-700 dark:text-amber-400'
                                    : 'text-gray-500'
                                }
                              >
                                {row.por_vencer_mes}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums">
                              <span
                                className={
                                  row.productos_vencidos_mes > 0
                                    ? 'font-medium text-red-700 dark:text-red-400'
                                    : 'text-gray-500'
                                }
                              >
                                {row.productos_vencidos_mes}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums">
                              <span
                                className={
                                  row.vencidos_costo > 0
                                    ? 'font-medium text-red-700 dark:text-red-400'
                                    : 'text-gray-500'
                                }
                              >
                                {fmtMoneda(row.vencidos_costo)}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top tabular-nums">
                              <span
                                className={
                                  Number(row.unidades_vencidos_vendidas) > 0
                                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                    : 'text-gray-500'
                                }
                              >
                                {Number(row.unidades_vencidos_vendidas).toLocaleString('es-AR', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold dark:border-gray-600 dark:bg-gray-900/60 lg:text-sm">
                          <td className="px-2 py-2 text-gray-900 dark:text-gray-100">Totales</td>
                          <td className="px-2 py-2 text-right">
                            {payload.seleccionMes.totales.total_base_trimestre > 0 ? (
                              <span className="inline-flex flex-col items-end leading-tight tabular-nums">
                                <span>
                                  {payload.seleccionMes.totales.inventariados_padron_trimestre}/
                                  {payload.seleccionMes.totales.total_base_trimestre}
                                </span>
                                <span className="text-[10px] font-normal text-gray-500 dark:text-gray-400">
                                  (
                                  {formatPorcentaje(
                                    payload.seleccionMes.totales
                                      .porcentaje_inventariados_sobre_base
                                  )}
                                  %)
                                </span>
                              </span>
                            ) : (
                              <span className="tabular-nums">
                                {payload.seleccionMes.totales.inventariados_padron_trimestre}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {celdaDiferencia(
                              payload.seleccionMes.totales.productos_con_diferencia,
                              inventariadosTotalMes
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <span
                              className={
                                payload.seleccionMes.totales.productos_mal_contados > 0
                                  ? 'font-medium text-violet-700 dark:text-violet-400'
                                  : ''
                              }
                            >
                              {payload.seleccionMes.totales.productos_mal_contados}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {payload.seleccionMes.totales.productos_cargados_vencimientos}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {payload.seleccionMes.totales.por_vencer_mes}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {payload.seleccionMes.totales.productos_vencidos_mes}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-red-800 dark:text-red-300">
                            {fmtMoneda(payload.seleccionMes.totales.vencidos_costo)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {Number(
                              payload.seleccionMes.totales.unidades_vencidos_vendidas
                            ).toLocaleString('es-AR', {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {payload.leyenda && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
              <p className="font-medium text-gray-800 dark:text-gray-200">Definiciones</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {payload.leyenda.productos_inventariados && (
                  <li>{payload.leyenda.productos_inventariados}</li>
                )}
                <li>{payload.leyenda.inventario_diferencias}</li>
                {payload.leyenda.productos_mal_contados && (
                  <li>{payload.leyenda.productos_mal_contados}</li>
                )}
                {payload.leyenda.inventario_diferencias_valor && (
                  <li>{payload.leyenda.inventario_diferencias_valor}</li>
                )}
                {payload.leyenda.productos_cargados_vencimientos && (
                  <li>{payload.leyenda.productos_cargados_vencimientos}</li>
                )}
                {payload.leyenda.por_vencer_mes && <li>{payload.leyenda.por_vencer_mes}</li>}
                {payload.leyenda.productos_vencidos_mes && (
                  <li>{payload.leyenda.productos_vencidos_mes}</li>
                )}
                {payload.leyenda.vencidos_costo && (
                  <li>{payload.leyenda.vencidos_costo}</li>
                )}
                <li>{payload.leyenda.vencidos_vendidas_unidades}</li>
                {payload.leyenda.bajas_stock && <li>{payload.leyenda.bajas_stock}</li>}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
