'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  RefreshCw,
  Wand2,
  Table2,
  FileSpreadsheet,
  X,
  DatabaseZap,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import PadronProductoEditor from '@/components/padron/PadronProductoEditor';
import PadronEdicionMasiva from '@/components/padron/PadronEdicionMasiva';
import PadronListMobile from '@/components/padron/PadronListMobile';
import PadronFiltroColumna from '@/components/padron/PadronFiltroColumna';
import {
  COLUMNAS_PADRON_CON_CATALOGO,
  evaluarValor,
  type ValorCatalogo,
} from '@/lib/padron/valores-catalogo';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import {
  DATATABLE_CARD_BODY_CLASS,
  DATATABLE_CARD_CLASS,
  DATATABLE_SECTION_CLASS,
  DATATABLE_STICKY_THEAD,
  DATATABLE_PAGE_ROOT,
} from '@/components/list/datatable-classes';
import { DatatableFooter } from '@/components/list/DatatableFooter';
import { DatatableScrollArea } from '@/components/list/DatatableScrollArea';
import { DatatableToolbar } from '@/components/list/DatatableToolbar';
import {
  type TamPaginaDatatable,
  TAM_PAGINA_DATATABLE_DEFAULT,
} from '@/components/list/datatable-pagination';
import type { PadronFiltrosColumna, PadronMeta, PadronSortDir } from '@/lib/padron-final-crud';

type Row = Record<string, unknown>;

function formatCell(value: unknown, max = 48): string {
  if (value === null || value === undefined) return '—';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export default function PadronProductosPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<PadronMeta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tamPagina, setTamPagina] = useState<TamPaginaDatatable>(TAM_PAGINA_DATATABLE_DEFAULT);
  const pageSize = tamPagina === 'all' ? 100_000 : tamPagina;
  const [q, setQ] = useState('');
  /** Vacío = búsqueda amplia en varias columnas. */
  const [searchColumn, setSearchColumn] = useState('');
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [todasLasColumnas, setTodasLasColumnas] = useState(false);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortBy, setSortBy] = useState('producto');
  const [sortDir, setSortDir] = useState<PadronSortDir>('asc');
  /** Filtros tipo Excel por columna visible. */
  const [filtros, setFiltros] = useState<PadronFiltrosColumna>({});

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editPk, setEditPk] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  /** PKs tildados para la edición masiva (se mantienen al paginar). */
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [masivaOpen, setMasivaOpen] = useState(false);
  /** Valores ya cargados en categoria / sub_categoria, para autocompletar y validar. */
  const [catalogos, setCatalogos] = useState<Record<string, ValorCatalogo[]>>({});

  const pksPagina = useMemo(
    () => (meta ? rows.map((r) => String(r[meta.primaryKey] ?? '')).filter(Boolean) : []),
    [rows, meta]
  );
  const seleccionadosSet = useMemo(() => new Set(seleccionados), [seleccionados]);
  const todosLaPaginaTildados =
    pksPagina.length > 0 && pksPagina.every((pk) => seleccionadosSet.has(pk));

  function toggleSeleccion(pk: string) {
    setSeleccionados((prev) =>
      prev.includes(pk) ? prev.filter((x) => x !== pk) : [...prev, pk]
    );
  }

  function toggleSeleccionPagina(checked: boolean) {
    setSeleccionados((prev) => {
      if (checked) return Array.from(new Set([...prev, ...pksPagina]));
      const enPagina = new Set(pksPagina);
      return prev.filter((pk) => !enPagina.has(pk));
    });
  }

  const tableColumns = useMemo(() => {
    if (!meta) return visibleCols;
    const pk = meta.primaryKey;
    if (todasLasColumnas) {
      return meta.columns.map((c) => c.name);
    }
    const cols = visibleCols.length > 0 ? visibleCols : meta.listDefaults;
    return cols.includes(pk) ? cols : [pk, ...cols];
  }, [meta, visibleCols, todasLasColumnas]);

  /** Solo filtran las columnas que están a la vista: una oculta no puede recortar el listado. */
  const filtrosVigentes = useMemo(() => {
    const visibles = new Set(tableColumns);
    const out: PadronFiltrosColumna = {};
    for (const [col, valores] of Object.entries(filtros)) {
      if (visibles.has(col) && valores.length > 0) out[col] = valores;
    }
    return out;
  }, [filtros, tableColumns]);
  const hayFiltros = Object.keys(filtrosVigentes).length > 0;
  const filtrosJson = hayFiltros ? JSON.stringify(filtrosVigentes) : '';

  function aplicarFiltro(col: string, valores: string[] | null) {
    setFiltros((prev) => {
      const next = { ...prev };
      if (valores === null) delete next[col];
      else next[col] = valores;
      return next;
    });
    setPage(1);
  }

  function quitarFiltros() {
    setFiltros({});
    setPage(1);
  }

  const checkHeaderRef = useRef<HTMLInputElement>(null);
  const checkFilaRefs = useRef<Array<HTMLInputElement | null>>([]);

  function enfocarCheck(indice: number) {
    if (indice < 0) {
      checkHeaderRef.current?.focus();
      return;
    }
    const el = checkFilaRefs.current[Math.min(indice, rows.length - 1)];
    if (!el) return;
    el.focus({ preventScroll: true });
    el.closest('tr')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Flechas para moverse entre casilleros (Espacio tilda, nativo del checkbox).
   * Con Shift, la fila de destino también queda tildada para seleccionar de corrido.
   * `indice` -1 es el casillero del encabezado.
   */
  function onKeyDownCheck(e: KeyboardEvent<HTMLInputElement>, indice: number) {
    const ultimo = rows.length - 1;
    let destino: number | null = null;
    if (e.key === 'ArrowDown') destino = Math.min(indice + 1, ultimo);
    else if (e.key === 'ArrowUp') destino = Math.max(indice - 1, -1);
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = ultimo;
    if (destino === null || ultimo < 0) return;

    e.preventDefault();
    if (e.shiftKey && destino >= 0 && meta) {
      const pks = [indice, destino]
        .filter((i) => i >= 0)
        .map((i) => String(rows[i]?.[meta.primaryKey] ?? ''))
        .filter(Boolean);
      setSeleccionados((prev) => Array.from(new Set([...prev, ...pks])));
    }
    enfocarCheck(destino);
  }

  const columnasSeleccionables = useMemo(() => {
    if (!meta) return [];
    return [...meta.columns].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
  }, [meta]);

  const searchColumnOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Todas (amplia)' }];
    for (const c of columnasSeleccionables) {
      opts.push({ value: c.name, label: c.name });
    }
    return opts;
  }, [columnasSeleccionables]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set('q', q.trim());
      if (searchColumn) params.set('searchColumn', searchColumn);
      if (filtrosJson) params.set('filters', filtrosJson);
      if (tableColumns.length > 0) {
        params.set('columns', tableColumns.join(','));
      }
      // Sin `sortBy` el backend usa su columna por defecto (no hace falta leer `meta` acá).
      if (sortBy) params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);

      const res = await fetch(`/api/admin/padron-productos?${params.toString()}`);
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar padrón');
        setRows([]);
        return;
      }

      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
      if (json.meta) {
        const m = json.meta as PadronMeta;
        setMeta(m);
        if (visibleCols.length === 0 && m.listDefaults) {
          setVisibleCols(m.listDefaults);
        }
      }
    } catch {
      setError('Error al cargar padrón');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, searchColumn, filtrosJson, tableColumns, sortBy, sortDir, router, visibleCols.length]);

  const recargarCatalogos = useCallback(() => {
    fetch('/api/admin/padron-productos/valores', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { catalogos?: Record<string, ValorCatalogo[]> }) => {
        if (j.catalogos) setCatalogos(j.catalogos);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    recargarCatalogos();
  }, [recargarCatalogos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrirEditar(pk: string) {
    if (!meta) return;
    setEditPk(pk);
    setDrawerOpen(true);
    setFormLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/padron-productos/${encodeURIComponent(pk)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar registro');
        setDrawerOpen(false);
        return;
      }
      setFormValues(json.data ?? {});
    } catch {
      setError('Error al cargar registro');
      setDrawerOpen(false);
    } finally {
      setFormLoading(false);
    }
  }

  function cerrarDrawer() {
    setDrawerOpen(false);
    setFormValues({});
    setEditPk(null);
  }

  /** Valores de clasificación que no existen todavía en el padrón. */
  function valoresNuevos(valores: Record<string, unknown>): Array<{ columna: string; valor: string }> {
    const nuevos: Array<{ columna: string; valor: string }> = [];
    for (const columna of COLUMNAS_PADRON_CON_CATALOGO) {
      const valor = String(valores[columna] ?? '').trim();
      if (!valor) continue;
      const res = evaluarValor(valor, catalogos[columna] ?? []);
      if (res?.tipo === 'nuevo') nuevos.push({ columna, valor });
    }
    return nuevos;
  }

  /** Pide confirmación si algún valor de clasificación no existe todavía. */
  async function confirmarValoresNuevos(valores: Record<string, unknown>): Promise<boolean> {
    const nuevos = valoresNuevos(valores);
    if (nuevos.length > 0) {
      const detalle = nuevos
        .map(({ columna, valor }) => {
          const similares = (
            evaluarValor(valor, catalogos[columna] ?? []) as
              | { tipo: 'nuevo'; similares: ValorCatalogo[] }
              | null
          )?.similares ?? [];
          const parecidos = similares.length
            ? `\n   Parecidos que ya existen: ${similares.map((x) => x.valor).join(', ')}`
            : '';
          return `• ${columna}: «${valor}»${parecidos}`;
        })
        .join('\n');

      const ok = await notify.confirm({
        title: nuevos.length === 1 ? 'Crear un valor nuevo' : 'Crear valores nuevos',
        message:
          `Estos valores no existen todavía en el padrón:\n\n${detalle}\n\n` +
          '¿Los creás igual? Si fue un error de tipeo, cancelá y elegí uno de los existentes.',
        confirmLabel: 'Crear igual',
        cancelLabel: 'Volver a revisar',
        variant: 'warning',
      });
      if (!ok) return false;
    }
    return true;
  }

  async function guardar() {
    if (!meta) return;
    if (!(await confirmarValoresNuevos(formValues))) return;

    setSaving(true);
    setError('');
    try {
      if (editPk) {
        const res = await fetch(
          `/api/admin/padron-productos/${encodeURIComponent(editPk)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formValues),
          }
        );
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Error al guardar');
          return;
        }
      }
      cerrarDrawer();
      await cargar();
      // Un valor recién creado tiene que aparecer como existente la próxima vez.
      recargarCatalogos();
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  function toggleVisibleCol(name: string) {
    setTodasLasColumnas(false);
    setVisibleCols((prev) => {
      if (prev.includes(name)) return prev.filter((c) => c !== name);
      return [...prev, name];
    });
    setPage(1);
  }

  function toggleTodasLasColumnas(checked: boolean) {
    if (!meta) return;
    setTodasLasColumnas(checked);
    setVisibleCols(
      checked ? meta.columns.map((c) => c.name) : meta.listDefaults
    );
    setPage(1);
  }

  function isSortedColumn(col: string) {
    return sortBy.toLowerCase() === col.toLowerCase();
  }

  function onSortColumn(col: string) {
    if (isSortedColumn(col)) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  }

  function sortIcon(col: string) {
    if (!isSortedColumn(col)) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3 w-3 text-blue-600" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3 text-blue-600" />
    );
  }

  async function sincronizarPadron(force = false) {
    setError('');
    if (!force) {
      const ok = await notify.confirm({
        title: 'Sincronizar padrón',
        message:
          'Se actualizará padron_final desde plexdr (productos) y proveedores Onze. Puede tardar varios minutos.',
        confirmLabel: 'Sincronizar',
        cancelLabel: 'Cancelar',
        variant: 'warning',
      });
      if (!ok) return;
    }

    setSincronizando(true);
    try {
      const res = await fetch('/api/admin/padron-productos/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        error?: string;
        message?: string;
        runId?: number;
        plexdr?: { productosLeidos?: number; actualizados?: number };
        proveedoresOnze?: { medicamentosLeidos?: number; actualizados?: number };
        failures?: Array<{ phase?: string; error?: string }>;
      };

      if (res.status === 409 || json.code === 'ALREADY_RUNNING') {
        const forzar = await notify.confirm({
          title: 'Sync ya en curso',
          message:
            json.message ??
            json.error ??
            'Ya hay un sync de padrón corriendo. ¿Cancelar el anterior y empezar uno nuevo?',
          confirmLabel: 'Forzar nuevo',
          cancelLabel: 'Esperar',
          variant: 'warning',
        });
        if (forzar) {
          await sincronizarPadron(true);
        }
        return;
      }

      if (!res.ok || json.ok === false) {
        const detail =
          json.failures?.map((f) => `${f.phase}: ${f.error}`).filter(Boolean).join(' · ') ||
          json.error ||
          json.message ||
          'No se pudo sincronizar el padrón';
        notify.error(detail);
        setError(detail);
        return;
      }

      const plexdr = json.plexdr;
      const prov = json.proveedoresOnze;
      const partes = [
        json.runId != null ? `run #${json.runId}` : null,
        plexdr
          ? `plexdr ${plexdr.actualizados ?? 0}/${plexdr.productosLeidos ?? 0}`
          : null,
        prov
          ? `proveedores ${prov.actualizados ?? 0}/${prov.medicamentosLeidos ?? 0}`
          : null,
      ].filter(Boolean);
      notify.success(
        partes.length > 0
          ? `Padrón sincronizado (${partes.join(' · ')})`
          : 'Padrón sincronizado correctamente'
      );
      await cargar();
    } catch {
      notify.error('Error al sincronizar el padrón');
      setError('Error al sincronizar el padrón');
    } finally {
      setSincronizando(false);
    }
  }

  async function exportarExcel() {
    setExportando(true);
    setError('');
    try {
      const params = new URLSearchParams({ sortBy, sortDir });
      if (q.trim()) params.set('q', q.trim());
      if (searchColumn) params.set('searchColumn', searchColumn);
      if (filtrosJson) params.set('filters', filtrosJson);
      if (tableColumns.length > 0) {
        params.set('columns', tableColumns.join(','));
      }
      const res = await fetch(`/api/admin/padron-productos/export?${params.toString()}`);
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Error al exportar Excel');
        return;
      }
      const truncated = res.headers.get('X-Padron-Export-Truncated') === '1';
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? 'padron-productos.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (truncated) {
        setError(
          'Se exportó un máximo de 100.000 filas. Acotá la búsqueda si necesitás el resto.'
        );
      }
    } catch {
      setError('Error al exportar Excel');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className={DATATABLE_PAGE_ROOT}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Table2 className="h-5 w-5 text-blue-600" />
              Padrón productos
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sincronizarPadron()}
            disabled={loading || sincronizando || exportando}
            loading={sincronizando}
            title="Actualiza padron_final desde plexdr y proveedores Onze"
          >
            <DatabaseZap className="h-4 w-4 mr-1" />
            Sincronizar padrón
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportarExcel()}
            disabled={loading || exportando || sincronizando || !meta}
            loading={exportando}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Exportar Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMasivaOpen(true)}
            disabled={!meta || loading || sincronizando}
            title="Modificar una o varias columnas en muchos productos"
          >
            <Wand2 className="h-4 w-4 mr-1" />
            Edición masiva
            {seleccionados.length > 0 ? ` (${seleccionados.length})` : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void cargar()}
            disabled={loading || sincronizando}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className={DATATABLE_CARD_CLASS}>
        <CardHeader className="shrink-0">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowColPicker((v) => !v)}
              >
                <Columns3 className="h-4 w-4 mr-1" />
                Columnas ({tableColumns.length || meta?.listDefaults.length || 0})
              </Button>
              {hayFiltros && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-gray-500">Filtros:</span>
                  {Object.entries(filtrosVigentes).map(([col, valores]) => (
                    <span
                      key={col}
                      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2 pr-1 text-blue-900"
                      title={valores.map((v) => (v === '' ? '(Vacías)' : v)).join(', ')}
                    >
                      <span className="font-medium">{col}</span>
                      <span className="max-w-[220px] truncate text-blue-800">
                        {valores.length === 1
                          ? valores[0] === ''
                            ? '(Vacías)'
                            : valores[0]
                          : `${valores.length} valores`}
                      </span>
                      <button
                        type="button"
                        onClick={() => aplicarFiltro(col, null)}
                        className="rounded-full p-0.5 hover:bg-blue-100"
                        aria-label={`Quitar filtro de ${col}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={quitarFiltros}
                    className="ml-1 text-gray-600 underline-offset-2 hover:underline"
                  >
                    Quitar todos
                  </button>
                </div>
              )}
            </div>

            {showColPicker && meta && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-600">
                    Elegí qué columnas mostrar. El Excel exporta las mismas columnas
                    visibles en la tabla.
                  </p>
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900">
                    <input
                      type="checkbox"
                      checked={todasLasColumnas}
                      onChange={(e) => toggleTodasLasColumnas(e.target.checked)}
                    />
                    Mostrar todas las columnas
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {columnasSeleccionables.map((c) => (
                    <label
                      key={c.name}
                      className="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={
                          todasLasColumnas ||
                          c.name === meta.primaryKey ||
                          visibleCols.includes(c.name) ||
                          (visibleCols.length === 0 &&
                            meta.listDefaults.includes(c.name))
                        }
                        disabled={c.name === meta.primaryKey || todasLasColumnas}
                        onChange={() => toggleVisibleCol(c.name)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className={DATATABLE_CARD_BODY_CLASS}>
          <div className={DATATABLE_SECTION_CLASS}>
          <DatatableToolbar
            busquedaTexto={q}
            onBusquedaChange={(v) => {
              setQ(v.trim());
              setPage(1);
            }}
            searchColumn={searchColumn}
            onSearchColumnChange={(v) => {
              setSearchColumn(v);
              setPage(1);
            }}
            searchColumnOptions={searchColumnOptions}
            tamPagina={tamPagina}
            onTamPaginaChange={(next) => {
              setTamPagina(next);
              setPage(1);
            }}
            paginaActual={page}
            onPaginaChange={setPage}
            totalFilas={total}
            searchPlaceholder={
              searchColumn
                ? `Buscar en ${searchColumn}… (Enter)`
                : 'Código, producto, categoría…'
            }
          />
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <PageSpinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">Sin registros.</p>
          ) : (
            <>
            <div className="datatable-rows-scroll row-start-2 min-h-0 overflow-auto overscroll-contain md:hidden print:hidden">
              <PadronListMobile
                rows={rows}
                columns={tableColumns}
                primaryKey={meta?.primaryKey ?? ''}
                seleccionados={seleccionadosSet}
                onToggleSeleccion={toggleSeleccion}
                onEditar={(pk) => void abrirEditar(pk)}
                formatCell={formatCell}
              />
            </div>
            <DatatableScrollArea fill className="row-start-2 hidden min-h-0 md:block">
              <table className="w-full min-w-max text-sm">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        ref={checkHeaderRef}
                        type="checkbox"
                        aria-label="Seleccionar todos los de esta página"
                        title="Seleccionar todos los de esta página (flechas para moverse, Espacio para tildar)"
                        checked={todosLaPaginaTildados}
                        onChange={(e) => toggleSeleccionPagina(e.target.checked)}
                        onKeyDown={(e) => onKeyDownCheck(e, -1)}
                      />
                    </th>
                    {tableColumns.map((col) => (
                      <th
                        key={col}
                        className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-600"
                      >
                        <span className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() => onSortColumn(col)}
                            className={`inline-flex items-center hover:text-blue-700 ${
                              isSortedColumn(col) ? 'text-blue-700' : ''
                            }`}
                            title="Ordenar por esta columna"
                          >
                            {col}
                            {sortIcon(col)}
                          </button>
                          <PadronFiltroColumna
                            columna={col}
                            filtroActual={filtrosVigentes[col]}
                            contexto={{ q, searchColumn, filtros: filtrosVigentes }}
                            onAplicar={(valores) => aplicarFiltro(col, valores)}
                          />
                        </span>
                      </th>
                    ))}
                    <th className="sticky right-0 bg-gray-50 px-3 py-2 text-right text-xs font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, indice) => {
                    const pk = meta ? String(row[meta.primaryKey] ?? '') : '';
                    const tildado = seleccionadosSet.has(pk);
                    return (
                      <tr
                        key={pk}
                        className={`scroll-mt-10 focus-within:shadow-[inset_3px_0_0_0_#2563eb] ${
                          tildado ? 'bg-blue-50/60' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            ref={(el) => {
                              checkFilaRefs.current[indice] = el;
                            }}
                            type="checkbox"
                            aria-label={`Seleccionar ${pk}`}
                            checked={tildado}
                            onChange={() => toggleSeleccion(pk)}
                            onKeyDown={(e) => onKeyDownCheck(e, indice)}
                          />
                        </td>
                        {tableColumns.map((col) => (
                          <td
                            key={col}
                            className="max-w-[200px] truncate px-3 py-2 text-gray-800"
                            title={formatCell(row[col], 200)}
                          >
                            {formatCell(row[col])}
                          </td>
                        ))}
                        <td className="sticky right-0 bg-white px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void abrirEditar(pk)}
                          >
                            Editar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DatatableScrollArea>
            <DatatableFooter
              paginaActual={page}
              onPaginaChange={setPage}
              totalFilas={total}
              tamPagina={tamPagina}
              detalle={`${total} registro${total === 1 ? '' : 's'}`}
            />
            </>
          )}
          </div>
        </CardContent>
      </Card>

      {masivaOpen && meta && (
        <PadronEdicionMasiva
          meta={meta}
          seleccionados={seleccionados}
          filtro={{ q, searchColumn, filtros: filtrosVigentes }}
          totalBusqueda={total}
          catalogos={catalogos}
          confirmarValoresNuevos={confirmarValoresNuevos}
          onCerrar={() => setMasivaOpen(false)}
          confirmar={(mensaje) =>
            notify.confirm({
              title: 'Confirmar edición masiva',
              message: mensaje,
              confirmLabel: 'Aplicar',
              cancelLabel: 'Cancelar',
              variant: 'warning',
            })
          }
          onAplicado={(r) => {
            setMasivaOpen(false);
            setSeleccionados([]);
            notify.success(
              `${r.actualizados} producto${r.actualizados === 1 ? '' : 's'} actualizado${
                r.actualizados === 1 ? '' : 's'
              } (${r.columnas.join(', ')})`
            );
            void cargar();
            recargarCatalogos();
          }}
        />
      )}

      {drawerOpen && meta && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            className="flex-1 bg-black/40"
            aria-label="Cerrar"
            onClick={cerrarDrawer}
          />
          <div className="flex h-full w-full max-w-3xl flex-col border-l border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Editar producto</h2>
              <button
                type="button"
                onClick={cerrarDrawer}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {formLoading ? (
                <PageSpinner />
              ) : (
                <PadronProductoEditor
                  columns={meta.columns}
                  primaryKey={meta.primaryKey}
                  values={formValues}
                  onChange={setFormValues}
                  readOnlyPk
                  catalogos={catalogos}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={cerrarDrawer}>
                  Cancelar
                </Button>
                <Button size="sm" loading={saving} onClick={() => void guardar()}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
