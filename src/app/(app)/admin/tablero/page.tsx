'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/spinner';
import { formatMoneda, formatPorcentaje } from '@/lib/utils';
import { calendarioActualArgentina, clampYmNoFuturo } from '@/lib/vencimientos-mes-anio-filtro';
import type { FilaTableroSucursal, TableroSucursales } from '@/lib/kpis/tablero-sucursales';

type Columna =
  | 'sucursal_nombre'
  | 'avance_pct'
  | 'desvio_pp'
  | 'faltantes'
  | 'faltantes_sobre_controlado_pct'
  | 'faltantes_sobre_stock_pct'
  | 'bajas_perdida'
  | 'bajas_sobre_facturacion_pct'
  | 'vales';

const INPUT =
  'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

function pctTexto(v: number | null | undefined): string {
  return v == null ? '—' : `${formatPorcentaje(v)} %`;
}

/** Rojo cuanto más atrasado; verde si va en hora. */
function claseDesvio(pp: number): string {
  if (pp <= -15) return 'font-semibold text-red-700 dark:text-red-400';
  if (pp < -5) return 'font-medium text-amber-700 dark:text-amber-400';
  return 'text-emerald-700 dark:text-emerald-400';
}

/** Un faltante alto sobre lo controlado es la señal más fuerte del tablero. */
function claseFaltantePct(v: number | null): string {
  if (v == null) return 'text-gray-400';
  if (v >= 1) return 'font-semibold text-red-700 dark:text-red-400';
  if (v >= 0.5) return 'font-medium text-amber-700 dark:text-amber-400';
  return 'text-gray-700 dark:text-gray-300';
}

export default function TableroSucursalesPage() {
  const mesMaximo = calendarioActualArgentina().ym;
  const [mes, setMes] = useState(mesMaximo);
  const [data, setData] = useState<TableroSucursales | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [orden, setOrden] = useState<Columna>('desvio_pp');
  const [asc, setAsc] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/tablero?mes=${mes}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        setError(json.error ?? 'No se pudo cargar el tablero');
        setData(null);
        return;
      }
      setData(json.data as TableroSucursales);
    } catch {
      setError('Error de red al cargar el tablero');
    } finally {
      setCargando(false);
    }
  }, [mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filas = useMemo(() => {
    const lista = [...(data?.filas ?? [])];
    lista.sort((a, b) => {
      const va = a[orden];
      const vb = b[orden];
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'es') * (asc ? 1 : -1);
      }
      const na = va == null ? Number.NEGATIVE_INFINITY : Number(va);
      const nb = vb == null ? Number.NEGATIVE_INFINITY : Number(vb);
      return (na - nb) * (asc ? 1 : -1);
    });
    return lista;
  }, [data, orden, asc]);

  const totales = useMemo(() => {
    const base = (data?.filas ?? []).reduce(
      (acc, f) => ({
        faltantes: acc.faltantes + f.faltantes,
        controlado: acc.controlado + f.stock_controlado,
        stockTotal: acc.stockTotal + f.stock_total,
        perdida: acc.perdida + f.bajas_perdida,
        facturacion: acc.facturacion + f.facturacion,
        vales: acc.vales + f.vales,
        inventariados: acc.inventariados + f.avance_inventariados,
        total: acc.total + f.avance_total,
      }),
      {
        faltantes: 0,
        controlado: 0,
        stockTotal: 0,
        perdida: 0,
        facturacion: 0,
        vales: 0,
        inventariados: 0,
        total: 0,
      }
    );
    const avance = base.total > 0 ? Math.round((base.inventariados / base.total) * 1000) / 10 : 0;
    return {
      ...base,
      avance,
      faltantePct: base.controlado > 0 ? (base.faltantes / base.controlado) * 100 : null,
      faltanteStockPct: base.stockTotal > 0 ? (base.faltantes / base.stockTotal) * 100 : null,
      bajasPct: base.facturacion > 0 ? (base.perdida / base.facturacion) * 100 : null,
    };
  }, [data]);

  function encabezado(col: Columna, etiqueta: string, hint?: string, alinear: 'left' | 'right' = 'right') {
    const activa = orden === col;
    return (
      <th className={`px-2 py-2 ${alinear === 'right' ? 'text-right' : 'text-left'} font-medium`}>
        <button
          type="button"
          title={hint}
          onClick={() => {
            if (activa) setAsc((v) => !v);
            else {
              setOrden(col);
              setAsc(col === 'desvio_pp' || col === 'sucursal_nombre');
            }
          }}
          className={`inline-flex items-center gap-1 hover:text-blue-700 dark:hover:text-blue-400 ${
            activa ? 'text-blue-700 dark:text-blue-400' : ''
          }`}
        >
          {etiqueta}
          {activa ? <span aria-hidden>{asc ? '▲' : '▼'}</span> : null}
        </button>
      </th>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
              <LayoutDashboard className="h-5 w-5 text-blue-600" />
              Tablero de sucursales
            </h1>
            {data && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {data.trimestre} · día hábil {data.dias_habiles_transcurridos} de{' '}
                {data.dias_habiles_totales} · esperado {formatPorcentaje(data.esperado_pct)} %
              </p>
            )}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Mes</span>
          <input
            type="month"
            value={mes}
            max={mesMaximo}
            onChange={(e) => setMes(clampYmNoFuturo(e.target.value, mesMaximo))}
            className={INPUT}
          />
        </label>
      </div>

      {data?.avisos?.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {data.avisos.map((a) => (
            <p key={a} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      ) : null}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {cargando ? (
        <PageSpinner />
      ) : data ? (
        <Card>
          <CardHeader className="py-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              El <strong>desvío</strong> es avance real menos esperado: el número para detectar
              atrasos. <strong>Faltante %</strong> compara los faltantes contra el stock que
              realmente se controló; la columna gris es contra el stock total, como se mostraba
              antes. <strong>Bajas</strong> son solo pérdidas efectivas (vencidos, roturas, uso
              interno); las devoluciones recuperables van aparte.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  {encabezado('sucursal_nombre', 'Sucursal', undefined, 'left')}
                  {encabezado('avance_pct', 'Avance', 'Productos inventariados sobre la base del trimestre')}
                  <th className="px-2 py-2 text-right font-medium">Esperado</th>
                  {encabezado('desvio_pp', 'Desvío', 'Avance real menos esperado, en puntos')}
                  {encabezado('faltantes', 'Faltantes $', 'Faltantes a costo de los controles cerrados del mes')}
                  {encabezado(
                    'faltantes_sobre_controlado_pct',
                    'Falt. %',
                    'Faltantes sobre el stock a costo efectivamente controlado'
                  )}
                  {encabezado(
                    'faltantes_sobre_stock_pct',
                    's/ stock total',
                    'Faltantes sobre el stock total valorizado (criterio anterior)'
                  )}
                  {encabezado('bajas_perdida', 'Bajas $', 'Pérdidas efectivas a PVP')}
                  {encabezado('bajas_sobre_facturacion_pct', 'Bajas %', 'Pérdidas sobre facturación neta')}
                  {encabezado('vales', 'Vales', 'Vales generados en el mes')}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filas.map((f: FilaTableroSucursal) => (
                  <tr key={f.sucursal_id} className="hover:bg-gray-50/80 dark:hover:bg-gray-900/40">
                    <td className="py-2 pr-2">
                      <Link
                        href={`/kpis?mes=${data.ym}&sucursal_id=${f.sucursal_id}`}
                        className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                      >
                        {f.sucursal_nombre}
                      </Link>
                      {f.es_drogueria && (
                        <span className="ml-1 rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                          Droguería
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                      {formatPorcentaje(f.avance_pct)} %
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">
                      {formatPorcentaje(f.esperado_pct)} %
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums ${claseDesvio(f.desvio_pp)}`}>
                      {f.desvio_pp > 0 ? '+' : ''}
                      {formatPorcentaje(f.desvio_pp)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                      {f.faltantes > 0 ? formatMoneda(f.faltantes) : '—'}
                    </td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums ${claseFaltantePct(
                        f.faltantes_sobre_controlado_pct
                      )}`}
                      title={
                        f.stock_controlado > 0
                          ? `Controlado: ${formatMoneda(f.stock_controlado)}`
                          : 'Sin controles valorizados en el mes'
                      }
                    >
                      {pctTexto(f.faltantes_sobre_controlado_pct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-400">
                      {pctTexto(f.faltantes_sobre_stock_pct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200">
                      {f.bajas_perdida > 0 ? formatMoneda(f.bajas_perdida) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200">
                      {pctTexto(f.bajas_sobre_facturacion_pct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200">
                      {f.vales.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}

                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-900/60">
                  <td className="py-2 pr-2 text-gray-900 dark:text-gray-100">Cadena</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatPorcentaje(totales.avance)} %
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">
                    {formatPorcentaje(data.esperado_pct)} %
                  </td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums ${claseDesvio(
                      totales.avance - data.esperado_pct
                    )}`}
                  >
                    {formatPorcentaje(totales.avance - data.esperado_pct)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                    {formatMoneda(totales.faltantes)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {pctTexto(totales.faltantePct)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-400">
                    {pctTexto(totales.faltanteStockPct)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatMoneda(totales.perdida)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{pctTexto(totales.bajasPct)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {totales.vales.toLocaleString('es-AR')}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
