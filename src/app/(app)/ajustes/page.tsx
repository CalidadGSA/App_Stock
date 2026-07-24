'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import AjustesDiferenciasListMobile from '@/components/ajustes/AjustesDiferenciasListMobile';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import {
  claveDupAjuste,
  idsDuplicadosMasViejosADescartar,
} from '@/lib/inventario/ajustes-duplicados';

interface SucursalOption {
  id: string;
  nombre: string;
}

interface DiferenciaItem {
  id: string;
  producto_id_sistema: string;
  /** Puede repetirse el mismo producto+código en más de un control del periodo */
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
  origen?: string | null;
  diffCajas: number;
  diffUnidades: number;
  fecha_registro?: string | null;
  fecha_fin_control?: string | null;
}

function claveDupDiferencia(d: Pick<DiferenciaItem, 'producto_id_sistema' | 'codigo_barras'>) {
  return claveDupAjuste(d.producto_id_sistema, d.codigo_barras);
}

export default function AjustesPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [origenFiltro, setOrigenFiltro] = useState<'todos' | 'Sucursal' | 'Auditoria'>('todos');
  const [soloRepetidos, setSoloRepetidos] = useState(false);
  const [loadingSucursales, setLoadingSucursales] = useState(true);
  const [loadingDiferencias, setLoadingDiferencias] = useState(false);
  const [diferencias, setDiferencias] = useState<DiferenciaItem[]>([]);
  const [exportando, setExportando] = useState(false);
  const [eliminandoRepetidosViejos, setEliminandoRepetidosViejos] = useState(false);
  const [error, setError] = useState('');
  const [busquedaBorrador, setBusquedaBorrador] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');

  const clavesDuplicadas = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const d of diferencias) {
      const k = claveDupDiferencia(d);
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
    const dup = new Set<string>();
    for (const [k, n] of cuenta) {
      if (n > 1) dup.add(k);
    }
    return dup;
  }, [diferencias]);

  const diferenciasFiltradasBusqueda = useMemo(() => {
    const term = busquedaAplicada.trim().toLowerCase();
    if (!term) return diferencias;
    return diferencias.filter((d) => {
      const texto = [
        d.descripcion,
        d.presentacion ?? '',
        d.laboratorio ?? '',
        d.codigo_barras,
        d.producto_id_sistema,
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(term);
    });
  }, [diferencias, busquedaAplicada]);

  const idsRepetidosViejos = useMemo(
    () => idsDuplicadosMasViejosADescartar(diferencias),
    [diferencias]
  );

  const diferenciasVisibles = useMemo(() => {
    if (!soloRepetidos) return diferenciasFiltradasBusqueda;
    return diferenciasFiltradasBusqueda.filter((d) => clavesDuplicadas.has(claveDupDiferencia(d)));
  }, [diferenciasFiltradasBusqueda, soloRepetidos, clavesDuplicadas]);

  useEffect(() => {
    async function cargarSucursales() {
      setLoadingSucursales(true);
      try {
        const res = await fetch('/api/admin/sucursales');
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar sucursales');
          return;
        }
        const list: SucursalOption[] = json.data ?? [];
        setSucursales(list);
        if (list.length === 1) {
          setSucursalId(list[0].id);
        }
      } catch {
        setError('Error al cargar sucursales');
      } finally {
        setLoadingSucursales(false);
      }
    }
    void cargarSucursales();
  }, []);

  async function cargarDiferencias(opts?: {
    sucursalId?: string;
    origenFiltro?: 'todos' | 'Sucursal' | 'Auditoria';
  }) {
    const sid = opts?.sucursalId ?? sucursalId;
    const origen = opts?.origenFiltro ?? origenFiltro;

    setError('');
    setDiferencias([]);
    setBusquedaBorrador('');
    setBusquedaAplicada('');
    if (!sid || !desde || !hasta) {
      setError('Seleccioná sucursal, fecha desde y fecha hasta.');
      return;
    }
    if (hasta < desde) {
      setError('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
      return;
    }
    setLoadingDiferencias(true);
    try {
      const params = new URLSearchParams({
        sucursal_id: sid,
        desde,
        hasta,
      });
      if (origen !== 'todos') {
        params.set('origen', origen);
      }
      const res = await fetch(`/api/inventario/diferencias?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar diferencias');
        return;
      }
      const items: DiferenciaItem[] = (json.data ?? []).map((r: any) => {
        const sistC = r.stock_sist_cajas ?? 0;
        const sistU = r.stock_sist_unidades ?? 0;
        const realC = r.stock_real_cajas ?? 0;
        const realU = r.stock_real_unidades ?? 0;
        return {
          id: r.id,
          producto_id_sistema: r.producto_id_sistema,
          codigo_barras: r.codigo_barras,
          descripcion: r.descripcion,
          presentacion: r.presentacion ?? null,
          laboratorio: r.laboratorio ?? null,
          stock_sist_cajas: r.stock_sist_cajas,
          stock_sist_unidades: r.stock_sist_unidades,
          stock_real_cajas: r.stock_real_cajas,
          stock_real_unidades: r.stock_real_unidades,
          origen: r.controles_inventario?.origen ?? null,
          fecha_registro: r.fecha_registro ?? null,
          fecha_fin_control: r.controles_inventario?.fecha_fin ?? null,
          diffCajas: realC - sistC,
          diffUnidades: realU - sistU,
        };
      });
      setDiferencias(items);
    } catch {
      setError('Error al cargar diferencias');
    } finally {
      setLoadingDiferencias(false);
    }
  }

  async function handleEliminarDiferencia(id: string) {
    setError('');
    try {
      const res = await fetch(`/api/inventario/diferencias?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar diferencia');
        return;
      }
      setDiferencias((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError('Error al eliminar diferencia');
    }
  }

  async function handleEliminarRepetidosViejos() {
    if (idsRepetidosViejos.length === 0) return;
    setError('');
    const ok = await notify.confirm({
      title: 'Quitar repetidos',
      message: `Se quitarán ${idsRepetidosViejos.length} diferencia${
        idsRepetidosViejos.length !== 1 ? 's' : ''
      } repetida${idsRepetidosViejos.length !== 1 ? 's' : ''} y quedará solo la más reciente de cada producto. ¿Continuar?`,
    });
    if (!ok) return;

    setEliminandoRepetidosViejos(true);
    try {
      const res = await fetch('/api/inventario/diferencias/descartar-repetidos-viejos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: sucursalId,
          desde,
          hasta,
          origen: origenFiltro,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al quitar repetidos');
        return;
      }
      const descartados = Number(json.descartados ?? 0);
      const idsQuitar = new Set(idsRepetidosViejos);
      setDiferencias((prev) => prev.filter((d) => !idsQuitar.has(d.id)));
      notify.success(
        descartados > 0
          ? `Se quitaron ${descartados} repetido${descartados !== 1 ? 's' : ''} más viejos${descartados !== 1 ? 's' : ''}.`
          : 'No había repetidos para quitar.'
      );
    } catch {
      setError('Error al quitar repetidos');
    } finally {
      setEliminandoRepetidosViejos(false);
    }
  }

  async function handleExportar() {
    setError('');
    if (!sucursalId || !desde || !hasta) {
      setError('Seleccioná sucursal, fecha desde y fecha hasta.');
      return;
    }
    if (hasta < desde) {
      setError('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
      return;
    }
    if (diferencias.length === 0) {
      setError('No hay diferencias para exportar con los filtros seleccionados.');
      return;
    }
    setExportando(true);
    try {
      const params = new URLSearchParams({
        sucursal_id: sucursalId,
        desde,
        hasta,
      });
      // Si el origen es "todos" exportamos diferencias de ambos orígenes.
      if (origenFiltro !== 'todos') {
        params.set('origen', origenFiltro);
      }
      const res = await fetch(`/api/inventario/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Error al exportar diferencias');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? 'inventario.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Error al exportar diferencias');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold text-gray-900 sm:text-xl dark:text-gray-100">Ajustes</h1>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => router.push('/dashboard')}
        >
          Volver al dashboard
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">
            Exportar diferencias de inventario
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingSucursales ? (
            <PageSpinner />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Sucursal
                </label>
                <select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900
                    focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Seleccionar sucursal</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
                <div className="w-full sm:w-auto">
                  <Input
                    label="Desde"
                    type="date"
                    value={desde}
                    onChange={(e) => setDesde(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <Input
                    label="Hasta"
                    type="date"
                    value={hasta}
                    onChange={(e) => setHasta(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    const hoy = new Date();
                    const yyyy = hoy.getFullYear();
                    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
                    const dd = String(hoy.getDate()).padStart(2, '0');
                    const hoyStr = `${yyyy}-${mm}-${dd}`;
                    setDesde(hoyStr);
                    setHasta(hoyStr);
                  }}
                >
                  Hoy
                </Button>
                <div className="flex w-full flex-col gap-1 sm:w-auto">
                  <label className="text-sm font-medium text-gray-700">
                    Origen
                  </label>
                  <select
                    value={origenFiltro}
                    onChange={(e) =>
                      setOrigenFiltro(e.target.value as 'todos' | 'Sucursal' | 'Auditoria')
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                      focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="todos">Todos</option>
                    <option value="Sucursal">Sucursal</option>
                    <option value="Auditoria">Auditoría</option>
                  </select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => void cargarDiferencias()}
                  disabled={loadingDiferencias}
                >
                  Ver diferencias
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={handleExportar}
                  loading={exportando}
                  disabled={
                    exportando ||
                    !sucursalId ||
                    !desde ||
                    !hasta ||
                    diferencias.length === 0
                  }
                >
                  Exportar CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => router.push('/ajustes/historial')}
                >
                  Ver historial de ajustes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-gray-900">
              Diferencias pendientes de ajuste
              {diferencias.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({diferenciasVisibles.length}
                  {soloRepetidos ? ' repetidos' : ''}
                  {busquedaAplicada.trim() ? ' filtrados' : ''} de {diferencias.length})
                </span>
              ) : null}
            </h2>
            {diferencias.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={soloRepetidos}
                    onChange={(e) => setSoloRepetidos(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Solo repetidos
                </label>
                {idsRepetidosViejos.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    loading={eliminandoRepetidosViejos}
                    disabled={eliminandoRepetidosViejos || loadingDiferencias}
                    onClick={() => void handleEliminarRepetidosViejos()}
                  >
                    Quitar repetidos ({idsRepetidosViejos.length})
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {diferencias.length > 0 ? (
            <div className="relative w-full sm:max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={busquedaBorrador}
                onChange={(e) => setBusquedaBorrador(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setBusquedaAplicada(busquedaBorrador.trim());
                  }
                }}
                placeholder="Buscar producto, código, laboratorio… (Enter)"
                className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100"
                aria-label="Buscar producto"
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {loadingDiferencias ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : diferencias.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              No hay diferencias pendientes para los filtros seleccionados.
            </p>
          ) : diferenciasVisibles.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">
              {busquedaAplicada.trim() && soloRepetidos
                ? 'No hay productos repetidos que coincidan con la búsqueda.'
                : busquedaAplicada.trim()
                  ? 'No hay productos que coincidan con la búsqueda.'
                  : 'No hay productos repetidos en el periodo con los filtros seleccionados.'}
            </p>
          ) : (
            <>
            <div className="md:hidden">
              <AjustesDiferenciasListMobile
                items={diferenciasVisibles}
                clavesDuplicadas={clavesDuplicadas}
                onQuitar={(id) => void handleEliminarDiferencia(id)}
              />
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[720px] w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Producto
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Código barras
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Origen
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Sist. (cajas/unid.)
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Real (cajas/unid.)
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Diferencia
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diferenciasVisibles.map((d) => {
                    const esDuplicadoPeriodo = clavesDuplicadas.has(claveDupDiferencia(d));
                    return (
                    <tr
                      key={d.id}
                      className={
                        esDuplicadoPeriodo
                          ? 'bg-amber-50 dark:bg-amber-950/25'
                          : undefined
                      }
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">
                          {d.descripcion}
                        </p>
                        <p className="text-xs text-gray-500">
                          {d.presentacion} · {d.laboratorio}
                        </p>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">
                        {d.codigo_barras}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {d.origen === 'Auditoria' ? 'Auditoría' : 'Sucursal'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {(d.stock_sist_cajas ?? 0).toString()} /{' '}
                        {(d.stock_sist_unidades ?? 0).toString()}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {(d.stock_real_cajas ?? 0).toString()} /{' '}
                        {(d.stock_real_unidades ?? 0).toString()}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">
                        {d.diffCajas.toFixed(0)} / {d.diffUnidades.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleEliminarDiferencia(d.id)}
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  );
                  })}
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

