'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ClipboardList, Gauge, Receipt, Scale, Target, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime, formatMoneda, formatPorcentaje } from '@/lib/utils';
import { calendarioActualArgentina, clampYmNoFuturo } from '@/lib/vencimientos-mes-anio-filtro';
import type { KpisMensualesSucursal } from '@/lib/kpis/kpis-mensuales';

type Respuesta = KpisMensualesSucursal & {
  sucursal_nombre: string;
  puede_elegir_sucursal: boolean;
  /** Sucursal con la que está logueado el usuario (opción por defecto del selector). */
  sucursal_sesion: { id: string; nombre: string };
};

type SucursalOpcion = { id: string; nombre: string };

const INPUT_CLASS =
  'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

function formatoMesLargo(ym: string): string {
  const [y, m] = ym.split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function pctTexto(v: number | null | undefined): string {
  return v == null ? '—' : `${formatPorcentaje(v)} %`;
}

/** Positivo / negativo / neto en una fila compacta. */
function TrioSigno({
  positivo,
  negativo,
  neto,
  etiquetaPos = 'Positivo',
  etiquetaNeg = 'Negativo',
}: {
  positivo: number;
  negativo: number;
  neto: number;
  etiquetaPos?: string;
  etiquetaNeg?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-green-50 px-2 py-2 dark:bg-green-950/30">
        <p className="text-[11px] uppercase tracking-wide text-green-700 dark:text-green-300">{etiquetaPos}</p>
        <p className="text-sm font-semibold text-green-800 dark:text-green-200">{formatMoneda(positivo)}</p>
      </div>
      <div className="rounded-lg bg-red-50 px-2 py-2 dark:bg-red-950/30">
        <p className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-300">{etiquetaNeg}</p>
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">−{formatMoneda(negativo)}</p>
      </div>
      <div className="rounded-lg bg-gray-100 px-2 py-2 dark:bg-gray-800">
        <p className="text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-300">Neto</p>
        <p
          className={`text-sm font-semibold ${
            neto < 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {neto < 0 ? '−' : ''}
          {formatMoneda(Math.abs(neto))}
        </p>
      </div>
    </div>
  );
}

function AvisoFuente({ estado, error }: { estado: 'ok' | 'unavailable' | 'no_aplica'; error?: string }) {
  if (estado === 'ok') return null;
  const esNoAplica = estado === 'no_aplica';
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        esNoAplica
          ? 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
          : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {esNoAplica ? 'No aplica: ' : 'Onze no disponible: '}
        {error ?? 'sin detalle'}
      </span>
    </div>
  );
}

function Ratio({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
      <div>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</p>
        {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{pctTexto(value)}</p>
    </div>
  );
}

/** Una barra con la marca de lo esperado a la fecha. */
function BarraAvance({
  realPct,
  esperadoPct,
}: {
  realPct: number;
  esperadoPct: number;
}) {
  const atrasado = realPct + 0.05 < esperadoPct;
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
      <div
        className={`h-full rounded-full ${atrasado ? 'bg-amber-500' : 'bg-emerald-500'}`}
        style={{ width: `${Math.min(100, Math.max(0, realPct))}%` }}
      />
      <div
        className="absolute top-0 h-full w-0.5 bg-gray-900 dark:bg-gray-100"
        style={{ left: `${Math.min(100, Math.max(0, esperadoPct))}%` }}
        title={`Esperado: ${formatPorcentaje(esperadoPct)} %`}
      />
    </div>
  );
}

function Desvio({ pp }: { pp: number }) {
  const cls =
    pp < -5
      ? 'text-red-700 dark:text-red-300'
      : pp < 0
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-emerald-700 dark:text-emerald-300';
  return (
    <span className={`font-semibold tabular-nums ${cls}`}>
      {pp > 0 ? '+' : ''}
      {formatPorcentaje(pp)} %
    </span>
  );
}

const ETIQUETA_MACRO: Record<string, string> = {
  FARMA: 'Farma',
  BIENESTAR: 'Bienestar',
  PSICOTROPICOS: 'Psicotrópicos',
};

function KpisMensualesContenido() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mesMaximo = calendarioActualArgentina().ym;

  const [mes, setMes] = useState(() => clampYmNoFuturo(searchParams.get('mes') ?? '', mesMaximo));
  const [sucursalId, setSucursalId] = useState(() => searchParams.get('sucursal_id') ?? '');
  const [sucursales, setSucursales] = useState<SucursalOpcion[]>([]);
  const [data, setData] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ mes });
      if (sucursalId) q.set('sucursal_id', sucursalId);
      const res = await fetch(`/api/kpis/mensuales?${q.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as { data?: Respuesta; error?: string };
      if (!res.ok || !json.data) {
        setError(json.error ?? 'No se pudieron cargar los KPIs');
        setData(null);
        return;
      }
      setData(json.data);
      // Sin permiso para elegir sucursal, la API responde con la de la sesión: limpiar el parámetro.
      const sucursalUrl = json.data.puede_elegir_sucursal ? sucursalId : '';
      if (sucursalUrl !== sucursalId) setSucursalId('');
      const url = new URLSearchParams({ mes });
      if (sucursalUrl) url.set('sucursal_id', sucursalUrl);
      router.replace(`/kpis?${url.toString()}`, { scroll: false });
    } catch {
      setError('Error de red al cargar los KPIs');
    } finally {
      setLoading(false);
    }
  }, [mes, sucursalId, router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Selector de sucursal solo para admin (la API lo confirma con puede_elegir_sucursal).
  useEffect(() => {
    if (!data?.puede_elegir_sucursal || sucursales.length > 0) return;
    fetch('/api/sucursales')
      .then((r) => r.json())
      .then((j: { data?: SucursalOpcion[] }) => setSucursales(j.data ?? []))
      .catch(() => undefined);
  }, [data?.puede_elegir_sucursal, sucursales.length]);

  const d = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">KPIs mensuales</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {d ? `${d.sucursal_nombre} · ${formatoMesLargo(d.ym)}` : 'Diferencias y bajas del mes de la sucursal'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {d?.puede_elegir_sucursal && (
            <div className="flex flex-col gap-1">
              <label htmlFor="kpi-sucursal" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Sucursal
              </label>
              <select
                id="kpi-sucursal"
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">{d.sucursal_sesion.nombre}</option>
                {sucursales
                  .filter((s) => s.id !== d.sucursal_sesion.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="kpi-mes" className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Mes
            </label>
            <input
              id="kpi-mes"
              type="month"
              value={mes}
              max={mesMaximo}
              onChange={(e) => setMes(clampYmNoFuturo(e.target.value, mesMaximo))}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      {loading && <PageSpinner />}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {!loading && d && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* KPI 1: diferencias vs stock valorizado */}
          <Card className="flex flex-col">
            <CardHeader className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Diferencias de inventario</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Todos los orígenes · a costo · {d.diferencias.lineas} líneas en {d.diferencias.controles} controles
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <TrioSigno
                positivo={d.diferencias.positivo}
                negativo={d.diferencias.negativo}
                neto={d.diferencias.neto}
                etiquetaPos="Sobrante"
                etiquetaNeg="Faltante"
              />

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Ratio
                  label="Neto / stock valorizado"
                  value={d.ratios.diferencias_neto_sobre_stock_pct}
                  hint="|neto| sobre stock a costo"
                />
                <Ratio
                  label="Bruto / stock valorizado"
                  value={d.ratios.diferencias_bruto_sobre_stock_pct}
                  hint="sobrante + faltante"
                />
              </div>

              <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-gray-500" />
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Stock valorizado</p>
                    {d.stock_valorizado.estado === 'ok' && (
                      <Badge
                        variant={
                          d.stock_valorizado.fuente === 'aproximado'
                            ? 'warning'
                            : d.stock_valorizado.fuente === 'snapshot'
                              ? 'info'
                              : 'success'
                        }
                      >
                        {d.stock_valorizado.fuente === 'actual'
                          ? 'stock actual'
                          : d.stock_valorizado.fuente === 'snapshot'
                            ? 'cierre del mes'
                            : 'aprox. (stock de hoy)'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {d.stock_valorizado.estado === 'ok' ? formatMoneda(d.stock_valorizado.valor_costo) : '—'}
                  </p>
                </div>
                {d.stock_valorizado.estado === 'ok' && (
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {d.stock_valorizado.productos.toLocaleString('es-AR')} productos ·{' '}
                    {d.stock_valorizado.cajas.toLocaleString('es-AR')} cajas · a costo PPP{' '}
                    {formatMoneda(d.stock_valorizado.valor_ppp)}
                    {d.stock_valorizado.tomado_at ? ` · ${formatDateTime(d.stock_valorizado.tomado_at)}` : ''}
                  </p>
                )}
                <div className="mt-2">
                  <AvisoFuente estado={d.stock_valorizado.estado} error={d.stock_valorizado.error} />
                </div>
              </div>

              {d.diferencias.lineas === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">Sin diferencias en controles cerrados este mes.</p>
              )}
            </CardContent>
          </Card>

          {/* KPI 2: bajas por motivo vs facturación */}
          <Card className="flex flex-col">
            <CardHeader className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white">
                <TrendingDown className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Bajas y altas de stock</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Operaciones de stock Onze por motivo · {d.bajas.lineas} líneas en {d.bajas.operaciones} operaciones
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <AvisoFuente estado={d.bajas.estado} error={d.bajas.error} />

              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  A precio de venta
                </p>
                <TrioSigno
                  positivo={d.bajas.pvp.positivo}
                  negativo={d.bajas.pvp.negativo}
                  neto={d.bajas.pvp.neto}
                  etiquetaPos="Altas"
                  etiquetaNeg="Bajas"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  A costo
                </p>
                <TrioSigno
                  positivo={d.bajas.costo.positivo}
                  negativo={d.bajas.costo.negativo}
                  neto={d.bajas.costo.neto}
                  etiquetaPos="Altas"
                  etiquetaNeg="Bajas"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Ratio
                  label="Bajas / facturación"
                  value={d.ratios.bajas_sobre_facturacion_pct}
                  hint="bajas a PVP sobre facturación neta"
                />
                <Ratio
                  label="Neto / facturación"
                  value={d.ratios.bajas_neto_sobre_facturacion_pct}
                  hint="|altas − bajas| a PVP"
                />
              </div>

              <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-gray-500" />
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Facturación neta del mes</p>
                  </div>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {d.facturacion.estado === 'ok' ? formatMoneda(d.facturacion.neta) : '—'}
                  </p>
                </div>
                {d.facturacion.estado === 'ok' && (
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {d.facturacion.comprobantes.toLocaleString('es-AR')} comprobantes FV/TF/TK por{' '}
                    {formatMoneda(d.facturacion.ventas_brutas)} − {d.facturacion.notas_credito_comprobantes} NC
                    vinculadas por {formatMoneda(d.facturacion.notas_credito)}
                  </p>
                )}
                <div className="mt-2">
                  <AvisoFuente estado={d.facturacion.estado} error={d.facturacion.error} />
                </div>
              </div>

              {d.bajas.por_motivo.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <th className="py-1 font-medium">Motivo</th>
                        <th className="py-1 text-right font-medium">Líneas</th>
                        <th className="py-1 text-right font-medium">Cajas</th>
                        <th className="py-1 text-right font-medium">A costo</th>
                        <th className="py-1 text-right font-medium">A PVP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.bajas.por_motivo.map((m) => {
                        const esBaja = m.alta_baja === 'B';
                        const cls = esBaja ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300';
                        return (
                          <tr key={m.motivo_id} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="py-1.5 text-gray-800 dark:text-gray-200">
                              <span className="mr-2 inline-block w-5 text-center text-[10px] font-bold uppercase text-gray-400">
                                {esBaja ? 'B' : 'A'}
                              </span>
                              {m.descripcion}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{m.lineas}</td>
                            <td className="py-1.5 text-right tabular-nums">{m.cajas.toLocaleString('es-AR')}</td>
                            <td className={`py-1.5 text-right tabular-nums ${cls}`}>
                              {esBaja ? '−' : ''}
                              {formatMoneda(m.valor_costo)}
                            </td>
                            <td className={`py-1.5 text-right tabular-nums ${cls}`}>
                              {esBaja ? '−' : ''}
                              {formatMoneda(m.valor_pvp)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {d.bajas.estado === 'ok' && d.bajas.por_motivo.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">Sin operaciones de stock este mes.</p>
              )}
            </CardContent>
          </Card>

          {/* KPI 3: avance de inventario esperado vs real */}
          <Card className="flex flex-col">
            <CardHeader className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Avance de inventario</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {d.avance_inventario.trimestre} · día hábil{' '}
                  {d.avance_inventario.dias_habiles_transcurridos} de{' '}
                  {d.avance_inventario.dias_habiles_totales}
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {d.avance_inventario.estado !== 'ok' ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {d.avance_inventario.error ?? 'Sin base de productos para el trimestre.'}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex items-baseline gap-2">
                        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                          {formatPorcentaje(d.avance_inventario.real_pct)} %
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          vs {formatPorcentaje(d.avance_inventario.esperado_pct)} % esperado
                        </p>
                      </div>
                      <Desvio pp={d.avance_inventario.desvio_pp} />
                    </div>
                    <BarraAvance
                      realPct={d.avance_inventario.real_pct}
                      esperadoPct={d.avance_inventario.esperado_pct}
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {d.avance_inventario.inventariados.toLocaleString('es-AR')} conteos hechos de{' '}
                      {d.avance_inventario.esperado.toLocaleString('es-AR')} esperados a la fecha {' '}
                      {d.avance_inventario.fuente !== 'actual' ? (
                        <>
                          {' '}
                          ·{' '}
                          <Badge variant={d.avance_inventario.fuente === 'snapshot' ? 'info' : 'warning'}>
                            {d.avance_inventario.fuente === 'snapshot'
                              ? 'cierre del mes'
                              : 'aprox. (avance de hoy)'}
                          </Badge>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    {d.avance_inventario.por_macro.map((m) => (
                      <div key={m.macro} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {ETIQUETA_MACRO[m.macro] ?? m.macro}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {m.inventariados.toLocaleString('es-AR')} /{' '}
                            {m.esperado.toLocaleString('es-AR')} esperados · <Desvio pp={m.desvio_pp} />
                          </span>
                        </div>
                        <BarraAvance realPct={m.real_pct} esperadoPct={m.esperado_pct} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* KPI 4: vales generados en el mes */}
          <Card className="flex flex-col">
            <CardHeader className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Vales generados</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Pendientes de entrega generados por la sucursal en el mes
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <AvisoFuente estado={d.vales.estado} error={d.vales.error} />

              {d.vales.estado === 'ok' && (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">
                      {d.vales.vales.toLocaleString('es-AR')}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {d.vales.lineas.toLocaleString('es-AR')} productos ·{' '}
                      {d.vales.unidades.toLocaleString('es-AR')} unidades
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-green-50 px-2 py-2 dark:bg-green-950/30">
                      <p className="text-[11px] uppercase tracking-wide text-green-700 dark:text-green-300">
                        Entregados
                      </p>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                        {d.vales.lineas_entregadas.toLocaleString('es-AR')}
                      </p>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-2 py-2 dark:bg-amber-950/30">
                      <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Pendientes
                      </p>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                        {d.vales.lineas_pendientes.toLocaleString('es-AR')}
                      </p>
                    </div>
                    <div className="rounded-lg bg-gray-100 px-2 py-2 dark:bg-gray-800">
                      <p className="text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-300">
                        Cancelados
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {d.vales.lineas_canceladas.toLocaleString('es-AR')}
                      </p>
                    </div>
                  </div>

                  {d.vales.vales_pendientes > 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {d.vales.vales_pendientes.toLocaleString('es-AR')} vale
                      {d.vales.vales_pendientes === 1 ? '' : 's'} del mes todavía con productos sin entregar.
                    </p>
                  )}

                  {d.vales.vales === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No se generaron vales este mes.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && d && (
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          Diferencias: controles cerrados en el mes (fecha de cierre), diferencia en cajas × costo de lista.
          Stock valorizado: onze_center.stock × costo de lista (misma base); para meses cerrados se usa el
          último valor guardado del mes. Bajas: stock_operaciones por motivo, signo según alta/baja, costo y
          PVP de cada línea. Facturación: FV/TF/TK del mes menos notas de crédito vinculadas a esas ventas
          (las NC a obras sociales no descuentan). Avance de inventario: el esperado es la fracción de días
          hábiles del trimestre ya transcurridos, así que arranca en 0 % y llega a 100 % el último día; el
          real cuenta productos inventariados, y en psicotrópicos las vueltas completas de la sucursal.
          Vales: comprobantes con productos pendientes de entrega generados por la sucursal en el mes.
        </p>
      )}
    </div>
  );
}

export default function KpisMensualesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <KpisMensualesContenido />
    </Suspense>
  );
}
