'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Boxes, Play } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

interface SucursalOpcion {
  sucursal: number;
  nombre: string;
  activa: boolean;
  es_drogueria: boolean;
}

interface Progreso {
  id: string;
  estado: 'inactivo' | 'corriendo' | 'completado' | 'error';
  paso: string;
  porcentaje: number;
  iniciado: string | null;
  terminado: string | null;
  operador: string | null;
  parametros: { trimestre: string; sucursales: number[] } | null;
  resumen: ResumenGeneracion | null;
  error: string | null;
  escrituraIniciada: boolean;
}

interface ResumenGeneracion {
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  incluyeDrogueria: boolean;
  filasSucursales: number;
  filasDrogueria: number;
  filasCantidadInventario: number;
  porCategoria: Record<string, number>;
  detalleSucursales: Array<{ idsucursal: number; filas: number }>;
  excluidos: {
    hospitalarios: number;
    precioMinimo: number;
    sinMovimiento: number;
    drogueriaSinPadron: number;
  };
  segundos: number;
}

interface BaseExistente {
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  porSucursal: Array<{ idsucursal: number; filas: number; inventariados: number }>;
  drogueria: { filas: number; inventariados: number } | null;
  total: number;
}

const CUATRIMESTRES = [1, 2, 3, 4] as const;

function formatoNumero(n: number): string {
  return n.toLocaleString('es-AR');
}

function formatoDuracion(segundos: number): string {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  if (min === 0) return `${seg} s`;
  return `${min} min ${String(seg).padStart(2, '0')} s`;
}

export default function BaseProductosPage() {
  const notify = useAppNotify();

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [sucursales, setSucursales] = useState<SucursalOpcion[]>([]);
  const [progreso, setProgreso] = useState<Progreso | null>(null);

  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [cuatrimestre, setCuatrimestre] = useState<number>(1);
  const [elegidas, setElegidas] = useState<number[]>([]);
  const [existente, setExistente] = useState<BaseExistente | null>(null);
  const [consultandoExistente, setConsultandoExistente] = useState(false);
  const [disparando, setDisparando] = useState(false);

  const yaInicializado = useRef(false);
  const corriendo = progreso?.estado === 'corriendo';

  const cargarEstado = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/base-productos', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo leer el estado');
        return;
      }
      setSucursales(data.sucursales ?? []);
      setProgreso(data.progreso ?? null);

      if (!yaInicializado.current) {
        yaInicializado.current = true;
        setAnio(Number(data.sugerido?.anio ?? new Date().getFullYear()));
        setCuatrimestre(Number(data.sugerido?.cuatrimestre ?? 1));
        setElegidas(
          (data.sucursales ?? [])
            .filter((s: SucursalOpcion) => s.activa)
            .map((s: SucursalOpcion) => s.sucursal)
        );
      }
      setError('');
    } catch {
      setError('Error de red al leer el estado');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarEstado();
  }, [cargarEstado]);

  // Mientras corre, refrescar el avance.
  useEffect(() => {
    if (!corriendo) return;
    const id = window.setInterval(() => void cargarEstado(), 2000);
    return () => window.clearInterval(id);
  }, [corriendo, cargarEstado]);

  // Al terminar una generación cambia lo que hay cargado, así que se vuelve a consultar.
  const jobCompletado = progreso?.estado === 'completado' ? progreso.id : '';

  // Avisar si ya hay base cargada para lo elegido.
  useEffect(() => {
    if (elegidas.length === 0) {
      setExistente(null);
      return;
    }
    let vigente = true;
    setConsultandoExistente(true);
    const params = new URLSearchParams({
      anio: String(anio),
      cuatrimestre: String(cuatrimestre),
      sucursales: elegidas.join(','),
    });
    fetch(`/api/admin/base-productos/existente?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (vigente && !d?.error) setExistente(d as BaseExistente);
      })
      .catch(() => undefined)
      .finally(() => {
        if (vigente) setConsultandoExistente(false);
      });
    return () => {
      vigente = false;
    };
  }, [anio, cuatrimestre, elegidas, jobCompletado]);

  const nombrePorSucursal = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sucursales) m.set(s.sucursal, s.nombre);
    return m;
  }, [sucursales]);

  const rango = useMemo(() => {
    const mesInicio = (cuatrimestre - 1) * 3 + 1;
    const mesFin = cuatrimestre * 3;
    const ultimoDia = new Date(anio, mesFin, 0).getDate();
    return {
      inicio: `01/${String(mesInicio).padStart(2, '0')}/${anio}`,
      fin: `${ultimoDia}/${String(mesFin).padStart(2, '0')}/${anio}`,
    };
  }, [anio, cuatrimestre]);

  function alternar(sucursal: number) {
    setElegidas((prev) =>
      prev.includes(sucursal) ? prev.filter((s) => s !== sucursal) : [...prev, sucursal].sort((a, b) => a - b)
    );
  }

  async function generar() {
    if (elegidas.length === 0) {
      notify.error('Elegí al menos una sucursal');
      return;
    }

    const trimestre = `Q${cuatrimestre}${anio}`;
    const hayExistente = (existente?.total ?? 0) > 0;
    const inventariados =
      (existente?.porSucursal.reduce((acc, s) => acc + s.inventariados, 0) ?? 0) +
      (existente?.drogueria?.inventariados ?? 0);

    const detalle = hayExistente
      ? `Ya hay ${formatoNumero(existente?.total ?? 0)} productos cargados en ${trimestre}` +
        (inventariados > 0
          ? `, y ${formatoNumero(inventariados)} ya fueron inventariados al menos una vez. Se pierde ese avance.`
          : '.') +
        '\n\nSe borra y se genera de nuevo.'
      : `Se va a generar la base de ${trimestre} (${rango.inicio} al ${rango.fin}) para ${elegidas.length} sucursal${elegidas.length === 1 ? '' : 'es'}.`;

    const ok = await notify.confirm({
      title: hayExistente ? `Reemplazar la base de ${trimestre}` : `Generar la base de ${trimestre}`,
      message: `${detalle}\n\nTarda entre 3 y 5 minutos. Podés cerrar la pantalla: el proceso sigue corriendo.`,
      confirmLabel: hayExistente ? 'Reemplazar' : 'Generar',
      cancelLabel: 'Cancelar',
      variant: hayExistente ? 'warning' : 'default',
    });
    if (!ok) return;

    setDisparando(true);
    try {
      const res = await fetch('/api/admin/base-productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anio,
          cuatrimestre,
          sucursales: elegidas,
          reemplazar: true,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        notify.error(data.error || 'No se pudo iniciar la generación');
        return;
      }

      setProgreso(data.progreso ?? null);
      notify.success(`Generación de ${trimestre} iniciada`);
    } catch {
      notify.error('Error de red al iniciar la generación');
    } finally {
      setDisparando(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <PageSpinner />
      </div>
    );
  }

  const resumen = progreso?.resumen ?? null;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
          <Boxes className="h-5 w-5 text-blue-600" />
          Generar bases de inventario
        </h1>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Trimestre</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Del {rango.inicio} al {rango.fin}.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-400">Año</span>
              <input
                type="number"
                min={2020}
                max={2100}
                value={anio}
                disabled={corriendo}
                onChange={(e) => setAnio(Number(e.target.value))}
                className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-400">Trimestre</span>
              <div className="flex gap-1">
                {CUATRIMESTRES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={corriendo}
                    onClick={() => setCuatrimestre(q)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      cuatrimestre === q
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200'
                    }`}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {consultandoExistente ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Revisando si ya hay base cargada…</p>
          ) : existente && existente.total > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-medium">
                Ya hay una base cargada para {existente.trimestre}: {formatoNumero(existente.total)} productos.
              </p>
              <p className="mt-1">
                Generar de nuevo la borra y la reemplaza, incluido el avance de lo ya inventariado.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No hay base cargada para este trimestre en las sucursales elegidas.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Sucursales</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {elegidas.length} de {sucursales.length} seleccionadas.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={corriendo}
                onClick={() => setElegidas(sucursales.map((s) => s.sucursal))}
              >
                Todas
              </Button>
              <Button size="sm" variant="outline" disabled={corriendo} onClick={() => setElegidas([])}>
                Ninguna
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sucursales.map((s) => {
              const tildada = elegidas.includes(s.sucursal);
              return (
                <label
                  key={s.sucursal}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    tildada
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                      : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-slate-900'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={tildada}
                    disabled={corriendo}
                    onChange={() => alternar(s.sucursal)}
                  />
                  <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                    <span className="text-gray-500 dark:text-gray-400">{s.sucursal}</span> {s.nombre}
                  </span>
                  {s.es_drogueria ? (
                    <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                      Droguería
                    </span>
                  ) : null}
                  {!s.activa ? (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      Inactiva
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void generar()}
              disabled={corriendo || disparando || elegidas.length === 0}
              loading={disparando}
            >
              <Play className="mr-1 h-4 w-4" />
              Generar base Q{cuatrimestre}
              {anio}
            </Button>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tarda entre 3 y 5 minutos. Podés cerrar la pantalla: sigue corriendo.
            </p>
          </div>

          {progreso && progreso.estado !== 'inactivo' ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {progreso.estado === 'corriendo'
                    ? progreso.paso
                    : progreso.estado === 'completado'
                      ? `Base de ${progreso.resumen?.trimestre ?? ''} generada`
                      : 'La generación falló'}
                </p>
                {progreso.operador ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Disparada por {progreso.operador}
                  </p>
                ) : null}
              </div>

              {progreso.estado === 'corriendo' ? (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(2, progreso.porcentaje))}%` }}
                  />
                </div>
              ) : null}

              {progreso.estado === 'error' ? (
                <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                  <p>{progreso.error}</p>
                  {progreso.escrituraIniciada ? (
                    <p className="mt-1 font-medium">
                      La escritura ya había empezado: el trimestre quedó incompleto. Volvé a generarlo.
                    </p>
                  ) : (
                    <p className="mt-1">No se tocó nada: los datos que había siguen intactos.</p>
                  )}
                </div>
              ) : null}

              {resumen && progreso.estado === 'completado' ? (
                <div className="mt-3 flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap gap-4 text-gray-700 dark:text-gray-300">
                    <span>
                      <strong>{formatoNumero(resumen.filasSucursales)}</strong> productos en sucursales
                    </span>
                    {resumen.incluyeDrogueria ? (
                      <span>
                        <strong>{formatoNumero(resumen.filasDrogueria)}</strong> en droguería
                      </span>
                    ) : null}
                    <span>
                      <strong>{resumen.diasHabiles}</strong> días hábiles
                    </span>
                    <span>en {formatoDuracion(resumen.segundos)}</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {Object.entries(resumen.porCategoria)
                      .sort(([a], [b]) => a.localeCompare(b, 'es'))
                      .map(([categoria, n]) => (
                        <span
                          key={categoria}
                          className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:ring-gray-700"
                        >
                          {categoria}: {formatoNumero(n)}
                        </span>
                      ))}
                  </div>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
                      Ver detalle por sucursal
                    </summary>
                    <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {resumen.detalleSucursales.map((d) => (
                        <div
                          key={d.idsucursal}
                          className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-slate-800"
                        >
                          <span className="truncate text-gray-700 dark:text-gray-300">
                            {nombrePorSucursal.get(d.idsucursal) ?? `Sucursal ${d.idsucursal}`}
                          </span>
                          <span className="shrink-0 font-medium text-gray-900 dark:text-gray-100">
                            {formatoNumero(d.filas)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Quedaron afuera: {formatoNumero(resumen.excluidos.hospitalarios)} hospitalarios,{' '}
                      {formatoNumero(resumen.excluidos.precioMinimo)} por precio mínimo y{' '}
                      {formatoNumero(resumen.excluidos.sinMovimiento)} sin stock ni ventas.
                    </p>
                  </details>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
