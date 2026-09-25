'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, History, TriangleAlert, X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDate, formatMoneda } from '@/lib/utils';
import type { IncidenciaHistorial, IncidenciaProducto } from '@/lib/inventario/incidencias';

type SucursalOpcion = { sucursal: number; nombre: string };

const INPUT =
  'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm outline-none ring-blue-500 focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

function nombreProducto(i: { descripcion: string; presentacion: string }): string {
  return [i.descripcion, i.presentacion].filter(Boolean).join(' ').trim();
}

/** Diferencia en cajas y unidades sueltas, con el signo adelante. */
function textoDiferencia(cajas: number, unidades: number): string {
  const partes: string[] = [];
  if (cajas !== 0) partes.push(`${cajas > 0 ? '+' : ''}${cajas} cj`);
  if (unidades !== 0) partes.push(`${unidades > 0 ? '+' : ''}${unidades} un`);
  return partes.length > 0 ? partes.join(' ') : '0';
}

function claseMonto(monto: number): string {
  if (monto < 0) return 'text-red-700 dark:text-red-400';
  if (monto > 0) return 'text-emerald-700 dark:text-emerald-400';
  return 'text-gray-500';
}

export default function IncidenciasPage() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [requiereMigracion, setRequiereMigracion] = useState(false);

  const [incidencias, setIncidencias] = useState<IncidenciaProducto[]>([]);
  const [sucursales, setSucursales] = useState<SucursalOpcion[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [limite, setLimite] = useState(100);

  const [detalle, setDetalle] = useState<IncidenciaProducto | null>(null);
  const [historial, setHistorial] = useState<IncidenciaHistorial[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const q = new URLSearchParams({ limite: String(limite) });
      if (sucursalId) q.set('sucursal_id', sucursalId);
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);

      const res = await fetch(`/api/admin/incidencias?${q}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? 'No se pudieron cargar las incidencias');
        setRequiereMigracion(Boolean(json.requiere_migracion));
        setIncidencias([]);
        return;
      }

      setRequiereMigracion(false);
      setIncidencias(json.incidencias ?? []);
      setSucursales(json.sucursales ?? []);
      if (!desde && json.periodo?.desde) setDesde(json.periodo.desde);
      if (!hasta && json.periodo?.hasta) setHasta(json.periodo.hasta);
    } catch {
      setError('Error de red al cargar las incidencias');
    } finally {
      setCargando(false);
    }
  }, [sucursalId, desde, hasta, limite]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrirHistorial(i: IncidenciaProducto) {
    setDetalle(i);
    setHistorial([]);
    setCargandoHistorial(true);
    try {
      const q = new URLSearchParams({
        producto: i.producto_id_sistema,
        sucursal_id: String(i.sucursal_id),
      });
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);
      const res = await fetch(`/api/admin/incidencias?${q}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setHistorial(json.historial ?? []);
    } catch {
      /* el panel muestra la lista vacía */
    } finally {
      setCargandoHistorial(false);
    }
  }

  const totales = useMemo(() => {
    return incidencias.reduce(
      (acc, i) => ({
        veces: acc.veces + i.veces,
        faltantes: acc.faltantes + i.faltantes,
        sobrantes: acc.sobrantes + i.sobrantes,
        monto: acc.monto + i.monto,
      }),
      { veces: 0, faltantes: 0, sobrantes: 0, monto: 0 }
    );
  }, [incidencias]);

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              <TriangleAlert className="h-5 w-5 text-amber-600" />
              Incidencias
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Productos que más veces aparecieron con diferencia en controles cerrados.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Sucursal</span>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className={INPUT}
            >
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s.sucursal} value={s.sucursal}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Desde</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Hasta</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Mostrar</span>
            <select
              value={limite}
              onChange={(e) => setLimite(Number(e.target.value))}
              className={INPUT}
            >
              {[10, 50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
          {requiereMigracion && (
            <p className="mt-1 pl-6 text-xs">
              Ejecutá esa migración en el SQL Editor de Supabase y recargá la pantalla.
            </p>
          )}
        </div>
      )}

      {cargando ? (
        <PageSpinner />
      ) : incidencias.length === 0 && !error ? (
        <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
          No hay productos con diferencias en el período elegido.
        </p>
      ) : incidencias.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {incidencias.length.toLocaleString('es-AR')} productos ·{' '}
              {totales.veces.toLocaleString('es-AR')} diferencias ·{' '}
              <span className="text-red-700 dark:text-red-400">
                {totales.faltantes.toLocaleString('es-AR')} faltantes
              </span>{' '}
              /{' '}
              <span className="text-emerald-700 dark:text-emerald-400">
                {totales.sobrantes.toLocaleString('es-AR')} sobrantes
              </span>{' '}
              · neto <span className={claseMonto(totales.monto)}>{formatMoneda(totales.monto)}</span>
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="py-2 pr-3 font-medium">Producto</th>
                  <th className="px-2 py-2 font-medium">Sucursal</th>
                  <th className="px-2 py-2 text-right font-medium">Veces</th>
                  <th className="px-2 py-2 text-right font-medium">Falt.</th>
                  <th className="px-2 py-2 text-right font-medium">Sobr.</th>
                  <th className="px-2 py-2 text-right font-medium">Dif. acum.</th>
                  <th className="px-2 py-2 text-right font-medium">Monto</th>
                  <th className="px-2 py-2 text-right font-medium">Última</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {incidencias.map((i) => (
                  <tr
                    key={`${i.sucursal_id}-${i.producto_id_sistema}`}
                    className="hover:bg-gray-50/80 dark:hover:bg-gray-900/40"
                  >
                    <td className="max-w-[320px] py-2 pr-3">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {nombreProducto(i) || i.producto_id_sistema}
                      </p>
                      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {i.producto_id_sistema}
                        {i.laboratorio ? ` · ${i.laboratorio}` : ''}
                      </p>
                    </td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{i.sucursal_nombre}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {i.veces}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                      {i.faltantes || ''}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {i.sobrantes || ''}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {textoDiferencia(i.dif_cajas, i.dif_unidades)}
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums ${claseMonto(i.monto)}`}>
                      {formatMoneda(i.monto)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-gray-500 dark:text-gray-400">
                      {i.ultima ? formatDate(i.ultima) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => void abrirHistorial(i)}>
                        <History className="mr-1 h-3.5 w-3.5" />
                        Histórico
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {detalle && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            className="flex-1 bg-black/40"
            aria-label="Cerrar"
            onClick={() => setDetalle(null)}
          />
          <div className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                  {nombreProducto(detalle) || detalle.producto_id_sistema}
                </h2>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {detalle.producto_id_sistema} · {detalle.sucursal_nombre} · {detalle.veces}{' '}
                  diferencias
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetalle(null)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {cargandoHistorial ? (
                <PageSpinner />
              ) : historial.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Sin movimientos.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {historial.map((h) => (
                    <div
                      key={h.control_id}
                      className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {h.fecha ? formatDate(h.fecha) : 'Sin fecha'}
                          {h.es_auditoria && (
                            <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                              Auditoría
                            </span>
                          )}
                          {h.ajustado && (
                            <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                              Ajustado
                            </span>
                          )}
                        </p>
                        <p className={`text-sm font-semibold tabular-nums ${claseMonto(h.monto)}`}>
                          {formatMoneda(h.monto)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                        Sistema {h.sist_cajas} cj / {h.sist_unidades} un · Real {h.real_cajas} cj /{' '}
                        {h.real_unidades} un ·{' '}
                        <span className="font-medium">
                          {textoDiferencia(h.dif_cajas, h.dif_unidades)}
                        </span>
                      </p>
                      {(h.tipo || h.origen) && (
                        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-500">
                          {[h.origen, h.tipo].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
