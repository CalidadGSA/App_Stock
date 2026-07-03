'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BarChart3 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DiferenciaCajasValorFila,
  DiferenciaCajasValorTotales,
  SignoDiferenciaCajas,
} from '@/app/api/admin/informe-mensual/diferencias-cajas/route';
import {
  MESES_CALENDARIO,
  calendarioActualArgentina,
  clampAnioMes,
  clampYmNoFuturo,
  mesesCalendarioSeleccionables,
  opcionesAnioHastaActual,
} from '@/lib/vencimientos-mes-anio-filtro';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/spinner';

interface SucursalOption {
  id: string;
  nombre: string;
}

function fmtMoneda(n: number) {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function valorCsv(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function productoEtiqueta(f: DiferenciaCajasValorFila): string {
  const extra = [f.presentacion, f.laboratorio].filter(Boolean).join(' · ');
  return extra ? `${f.descripcion} (${extra})` : f.descripcion;
}

function etiquetaSigno(signo: SignoDiferenciaCajas): string {
  if (signo === 'positiva') return 'Solo positivas';
  if (signo === 'negativa') return 'Solo negativas';
  return 'Todas';
}

function formatoMesCorto(ym: string) {
  const [y, m] = ym.trim().split('-');
  const mi = parseInt(m, 10);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  const mes = MESES_CALENDARIO.find((x) => x.value === mi);
  return `${mes?.label ?? m} ${y}`;
}

function ymDesdeAnioMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

function parseYmParts(ym: string): { anio: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (!Number.isFinite(anio) || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

type SortKey =
  | 'sucursal_nombre'
  | 'descripcion'
  | 'codigo_barras'
  | 'diff_cajas'
  | 'costo_caja'
  | 'valor_diferencia'
  | 'fecha_fin_control';

type SortDir = 'asc' | 'desc';

function compararFilas(
  a: DiferenciaCajasValorFila,
  b: DiferenciaCajasValorFila,
  key: SortKey,
  dir: SortDir
): number {
  let cmp = 0;
  if (key === 'sucursal_nombre' || key === 'descripcion' || key === 'codigo_barras') {
    const av = String(a[key] ?? '');
    const bv = String(b[key] ?? '');
    cmp = av.localeCompare(bv, 'es', { sensitivity: 'base', numeric: true });
  } else if (key === 'fecha_fin_control') {
    const av = a.fecha_fin_control ?? '';
    const bv = b.fecha_fin_control ?? '';
    if (!av && bv) cmp = 1;
    else if (av && !bv) cmp = -1;
    else cmp = av.localeCompare(bv);
  } else {
    cmp = Number(a[key]) - Number(b[key]);
  }

  if (cmp === 0 && key !== 'sucursal_nombre') {
    cmp = a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es', { sensitivity: 'base' });
  }
  if (cmp === 0) {
    cmp = a.descripcion.localeCompare(b.descripcion, 'es', { sensitivity: 'base' });
  }
  return dir === 'asc' ? cmp : -cmp;
}

function DiferenciasCajasValorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ym: mesMaximoYm, anio: anioActual, mes: mesActual } = calendarioActualArgentina();

  const [anio, setAnio] = useState(() => {
    const p = parseYmParts(searchParams.get('mes') ?? mesMaximoYm);
    return clampAnioMes(p?.anio ?? anioActual, p?.mes ?? mesActual).anio;
  });
  const [mesNum, setMesNum] = useState(() => {
    const p = parseYmParts(searchParams.get('mes') ?? mesMaximoYm);
    return clampAnioMes(p?.anio ?? anioActual, p?.mes ?? mesActual).mes;
  });
  const [signo, setSigno] = useState<SignoDiferenciaCajas>(() => {
    const s = searchParams.get('signo');
    return s === 'positiva' || s === 'negativa' ? s : 'todas';
  });
  const [sucursalId, setSucursalId] = useState(() => searchParams.get('sucursal_id') ?? '');
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [filas, setFilas] = useState<DiferenciaCajasValorFila[]>([]);
  const [totales, setTotales] = useState<DiferenciaCajasValorTotales | null>(null);
  const [mesConsultado, setMesConsultado] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('valor_diferencia');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const mesYm = clampYmNoFuturo(ymDesdeAnioMes(anio, mesNum), mesMaximoYm);

  const mesesOpts = useMemo(() => mesesCalendarioSeleccionables(anio), [anio]);
  const aniosOpts = useMemo(() => opcionesAnioHastaActual(7), []);

  function onAnioChange(nuevoAnio: number) {
    const clamped = clampAnioMes(nuevoAnio, mesNum);
    setAnio(clamped.anio);
    setMesNum(clamped.mes);
  }

  function onMesChange(nuevoMes: number) {
    const clamped = clampAnioMes(anio, nuevoMes);
    setMesNum(clamped.mes);
  }

  function alternarOrden(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(
      key === 'sucursal_nombre' || key === 'descripcion' || key === 'codigo_barras' ? 'asc' : 'desc'
    );
  }

  const filasOrdenadas = useMemo(() => {
    const copia = [...filas];
    copia.sort((a, b) => compararFilas(a, b, sortKey, sortDir));
    return copia;
  }, [filas, sortKey, sortDir]);

  const sucursalNombreFiltro = useMemo(() => {
    if (!sucursalId) return 'Todas';
    return sucursales.find((s) => s.id === sucursalId)?.nombre ?? `Sucursal ${sucursalId}`;
  }, [sucursalId, sucursales]);

  const nombreArchivoBase = useMemo(() => {
    const ym = mesConsultado || mesYm;
    const partes = ['diferencias-cajas', ym];
    if (sucursalId) partes.push(`suc-${sucursalId}`);
    if (signo !== 'todas') partes.push(signo);
    return partes.join('_');
  }, [mesConsultado, mesYm, sucursalId, signo]);

  const exportarExcel = useCallback(() => {
    if (filasOrdenadas.length === 0) return;

    const headers = [
      'Sucursal',
      'Producto',
      'Cód. barras',
      'Δ cajas',
      'Costo caja',
      'Valor',
      'Cierre control',
    ];
    const rows = filasOrdenadas.map((f) => [
      f.sucursal_nombre,
      productoEtiqueta(f),
      f.codigo_barras ?? '',
      f.diff_cajas,
      f.costo_caja,
      f.valor_diferencia,
      f.fecha_fin_control ? formatDateTime(f.fecha_fin_control) : '',
    ]);

    const totalRow = totales
      ? [
          'Totales',
          `${totales.lineas} líneas`,
          '',
          totales.diff_cajas,
          '',
          totales.valor_neto,
          '',
        ]
      : null;

    const csv = [headers, ...rows, ...(totalRow ? [totalRow] : [])]
      .map((row) => row.map((cell) => valorCsv(cell)).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombreArchivoBase}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [filasOrdenadas, nombreArchivoBase, totales]);

  const exportarPdf = useCallback(() => {
    if (filasOrdenadas.length === 0) return;

    const ym = mesConsultado || mesYm;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(11);
    doc.text(`Diferencias de inventario en cajas — ${formatoMesCorto(ym)}`, 14, 12);
    doc.setFontSize(9);
    doc.text(
      `Sucursal: ${sucursalNombreFiltro} · Diferencias: ${etiquetaSigno(signo)}`,
      14,
      18
    );

    autoTable(doc, {
      startY: 22,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [124, 58, 237] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [['Sucursal', 'Producto', 'Cód. barras', 'Δ cajas', 'Costo caja', 'Valor', 'Cierre']],
      body: filasOrdenadas.map((f) => [
        f.sucursal_nombre,
        productoEtiqueta(f),
        f.codigo_barras ?? '—',
        f.diff_cajas.toLocaleString('es-AR', { maximumFractionDigits: 2 }),
        fmtMoneda(f.costo_caja),
        fmtMoneda(f.valor_diferencia),
        f.fecha_fin_control ? formatDateTime(f.fecha_fin_control) : '—',
      ]),
      foot: totales
        ? [
            [
              'Totales',
              `${totales.lineas} líneas`,
              '',
              totales.diff_cajas.toLocaleString('es-AR', { maximumFractionDigits: 2 }),
              '',
              fmtMoneda(totales.valor_neto),
              '',
            ],
          ]
        : undefined,
    });

    doc.save(`${nombreArchivoBase}.pdf`);
  }, [
    filasOrdenadas,
    mesConsultado,
    mesYm,
    nombreArchivoBase,
    signo,
    sucursalNombreFiltro,
    totales,
  ]);

  function encabezadoOrdenable(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const activo = sortKey === key;
    const Icon = activo ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={`px-2 py-2 align-bottom ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => alternarOrden(key)}
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

  useEffect(() => {
    async function cargarSucursales() {
      try {
        const res = await fetch('/api/sucursales');
        const json = await res.json();
        if (res.ok) setSucursales(json.data ?? []);
      } catch {
        // filtro queda solo con "Todas"
      }
    }
    void cargarSucursales();
  }, []);

  const cargar = useCallback(async () => {
    const m = mesYm.trim();
    if (!m) return;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ mes: m, signo });
      if (sucursalId) q.set('sucursal_id', sucursalId);
      const res = await fetch(`/api/admin/informe-mensual/diferencias-cajas?${q.toString()}`);
      const json = await res.json();
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar diferencias');
        setFilas([]);
        setTotales(null);
        return;
      }
      setFilas(json.filas ?? []);
      setTotales(json.totales ?? null);
      setMesConsultado(json.mes ?? m);
    } catch {
      setError('Error de red al cargar diferencias');
      setFilas([]);
      setTotales(null);
    } finally {
      setLoading(false);
    }
  }, [mesYm, signo, sucursalId, router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => router.push('/admin/informe-mensual')}
          aria-label="Volver al informe mensual"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Diferencias de inventario en cajas (valor)
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Solo diferencias en cajas (se ignoran unidades sueltas). Valor = Δ cajas × costo por
            caja.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Filtros</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Año</span>
            <select
              value={anio}
              onChange={(e) => onAnioChange(Number(e.target.value))}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              {aniosOpts.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Mes</span>
            <select
              value={mesNum}
              onChange={(e) => onMesChange(Number(e.target.value))}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              {mesesOpts.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:min-w-[200px]">
            <span className="text-gray-600 dark:text-gray-400">Sucursal</span>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:min-w-[180px]">
            <span className="text-gray-600 dark:text-gray-400">Diferencias en cajas</span>
            <select
              value={signo}
              onChange={(e) => setSigno(e.target.value as SignoDiferenciaCajas)}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="todas">Todas</option>
              <option value="positiva">Solo positivas</option>
              <option value="negativa">Solo negativas</option>
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={() => void cargar()} loading={loading}>
            Actualizar
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      {loading && !totales ? (
        <PageSpinner />
      ) : (
        <>
          {totales && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Período</h3>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                    {formatoMesCorto(mesConsultado || mesYm)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Líneas</h3>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                    {totales.lineas.toLocaleString('es-AR')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Cajas (neto)
                  </h3>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                    {totales.diff_cajas.toLocaleString('es-AR', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-violet-700 dark:text-violet-300">
                    Valor positivo
                  </h3>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">
                    {fmtMoneda(totales.valor_positivo)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-red-700 dark:text-red-300">
                    Valor negativo
                  </h3>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-300">
                    {fmtMoneda(totales.valor_negativo)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Valor neto
                  </h3>
                </CardHeader>
                <CardContent>
                  <p
                    className={`text-2xl font-bold tabular-nums ${
                      totales.valor_neto > 0
                        ? 'text-violet-700 dark:text-violet-300'
                        : totales.valor_neto < 0
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-gray-900 dark:text-gray-50'
                    }`}
                  >
                    {fmtMoneda(totales.valor_neto)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Detalle por producto
                  </h2>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Controles cerrados con fecha de cierre en el mes seleccionado.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportarExcel}
                  disabled={filasOrdenadas.length === 0}
                >
                  Excel (CSV)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportarPdf}
                  disabled={filasOrdenadas.length === 0}
                >
                  PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filas.length === 0 ? (
                <p className="text-sm text-gray-500">Sin diferencias en cajas para estos filtros.</p>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {encabezadoOrdenable('sucursal_nombre', 'Sucursal')}
                      {encabezadoOrdenable('descripcion', 'Producto')}
                      {encabezadoOrdenable('codigo_barras', 'Cód. barras')}
                      {encabezadoOrdenable('diff_cajas', 'Δ cajas', 'right')}
                      {encabezadoOrdenable('costo_caja', 'Costo caja', 'right')}
                      {encabezadoOrdenable('valor_diferencia', 'Valor', 'right')}
                      {encabezadoOrdenable('fecha_fin_control', 'Cierre control')}
                    </tr>
                  </thead>
                  <tbody>
                    {filasOrdenadas.map((f) => (
                      <tr
                        key={f.detalle_id}
                        className="border-b border-gray-100 dark:border-gray-800"
                      >
                        <td className="px-2 py-2 whitespace-nowrap">{f.sucursal_nombre}</td>
                        <td className="px-2 py-2 min-w-[180px]">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {f.descripcion}
                          </div>
                          {(f.presentacion || f.laboratorio) && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {[f.presentacion, f.laboratorio].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">{f.codigo_barras ?? '—'}</td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums font-medium ${
                            f.diff_cajas > 0
                              ? 'text-violet-700 dark:text-violet-300'
                              : f.diff_cajas < 0
                                ? 'text-red-700 dark:text-red-300'
                                : ''
                          }`}
                        >
                          {f.diff_cajas.toLocaleString('es-AR', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtMoneda(f.costo_caja)}</td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums font-semibold ${
                            f.valor_diferencia > 0
                              ? 'text-violet-700 dark:text-violet-300'
                              : f.valor_diferencia < 0
                                ? 'text-red-700 dark:text-red-300'
                                : ''
                          }`}
                        >
                          {fmtMoneda(f.valor_diferencia)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                          {f.fecha_fin_control
                            ? formatDateTime(f.fecha_fin_control)
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

export default function DiferenciasCajasValorPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <DiferenciasCajasValorContent />
    </Suspense>
  );
}
