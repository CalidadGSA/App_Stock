'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Plus,
  RefreshCw,
  Table2,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import PadronProductoEditor from '@/components/padron/PadronProductoEditor';
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
import type { PadronMeta, PadronSortDir } from '@/lib/padron-final-crud';

type Row = Record<string, unknown>;

function formatCell(value: unknown, max = 48): string {
  if (value === null || value === undefined) return '—';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function emptyRow(meta: PadronMeta): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of meta.columns) {
    row[c.name] = '';
  }
  return row;
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
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [todasLasColumnas, setTodasLasColumnas] = useState(false);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortBy, setSortBy] = useState('producto');
  const [sortDir, setSortDir] = useState<PadronSortDir>('asc');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('edit');
  const [editPk, setEditPk] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportando, setExportando] = useState(false);

  const tableColumns = useMemo(() => {
    if (!meta) return visibleCols;
    const pk = meta.primaryKey;
    if (todasLasColumnas) {
      return meta.columns.map((c) => c.name);
    }
    const cols = visibleCols.length > 0 ? visibleCols : meta.listDefaults;
    return cols.includes(pk) ? cols : [pk, ...cols];
  }, [meta, visibleCols, todasLasColumnas]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set('q', q.trim());
      if (tableColumns.length > 0) {
        params.set('columns', tableColumns.join(','));
      }
      params.set('sortBy', sortBy || meta?.defaultSortColumn || 'producto');
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
  }, [page, pageSize, q, tableColumns, sortBy, sortDir, router, visibleCols.length]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrirEditar(pk: string) {
    if (!meta) return;
    setDrawerMode('edit');
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

  function abrirCrear() {
    if (!meta) return;
    setDrawerMode('create');
    setEditPk(null);
    setFormValues(emptyRow(meta));
    setDrawerOpen(true);
  }

  function cerrarDrawer() {
    setDrawerOpen(false);
    setFormValues({});
    setEditPk(null);
  }

  async function guardar() {
    if (!meta) return;
    setSaving(true);
    setError('');
    try {
      if (drawerMode === 'create') {
        const res = await fetch('/api/admin/padron-productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formValues),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Error al crear');
          return;
        }
      } else if (editPk) {
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
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function eliminar() {
    if (!editPk || !meta) return;
    if (
      !(await notify.confirm({
        title: 'Eliminar registro',
        message: `¿Eliminar el registro ${meta.primaryKey} = ${editPk}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        variant: 'danger',
      }))
    ) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        `/api/admin/padron-productos/${encodeURIComponent(editPk)}`,
        { method: 'DELETE' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar');
        return;
      }
      cerrarDrawer();
      await cargar();
    } catch {
      setError('Error al eliminar');
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

  async function exportarExcel() {
    setExportando(true);
    setError('');
    try {
      const params = new URLSearchParams({ sortBy, sortDir });
      if (q.trim()) params.set('q', q.trim());
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
            onClick={() => void exportarExcel()}
            disabled={loading || exportando || !meta}
            loading={exportando}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Exportar Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => void cargar()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
          <Button size="sm" onClick={abrirCrear} disabled={!meta}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo
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
            <div className="flex flex-wrap items-end gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowColPicker((v) => !v)}
              >
                <Columns3 className="h-4 w-4 mr-1" />
                Columnas ({tableColumns.length || meta?.listDefaults.length || 0})
              </Button>
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
                  {meta.columns.map((c) => (
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
            tamPagina={tamPagina}
            onTamPaginaChange={(next) => {
              setTamPagina(next);
              setPage(1);
            }}
            paginaActual={page}
            onPaginaChange={setPage}
            totalFilas={total}
            searchPlaceholder="Código, producto, categoría…"
          />
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <PageSpinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">Sin registros.</p>
          ) : (
            <>
            <DatatableScrollArea fill className="row-start-2 hidden min-h-0 md:block">
              <table className="w-full min-w-max text-sm">
                <thead className={DATATABLE_STICKY_THEAD}>
                  <tr>
                    {tableColumns.map((col) => (
                      <th
                        key={col}
                        className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-600"
                      >
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
                      </th>
                    ))}
                    <th className="sticky right-0 bg-gray-50 px-3 py-2 text-right text-xs font-medium text-gray-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const pk = meta ? String(row[meta.primaryKey] ?? '') : '';
                    return (
                      <tr key={pk} className="hover:bg-gray-50">
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
              <h2 className="text-lg font-semibold text-gray-900">
                {drawerMode === 'create' ? 'Nuevo producto' : 'Editar producto'}
              </h2>
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
                  readOnlyPk={drawerMode === 'edit'}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
              {drawerMode === 'edit' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-700 border-red-200 hover:bg-red-50"
                  onClick={() => void eliminar()}
                  loading={saving}
                >
                  Eliminar
                </Button>
              ) : (
                <span />
              )}
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
