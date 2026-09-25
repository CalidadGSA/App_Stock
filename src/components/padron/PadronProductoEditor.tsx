'use client';

import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { PadronColumnMeta } from '@/lib/padron-final-crud';
import { etiquetaOrigenPadron } from '@/lib/padron-columnas-sincronizadas';
import PadronCampoCatalogo from '@/components/padron/PadronCampoCatalogo';
import { esColumnaConCatalogo, type ValorCatalogo } from '@/lib/padron/valores-catalogo';

function groupColumn(name: string): string {
  const n = name.toLowerCase();
  if (/idproducto|codplex|codigo|codebar|troquel|sku|ean|barra/.test(n)) return 'Identificación';
  if (/cat|rub|sub|macro|clasif|tipo|familia|categoria/.test(n)) return 'Clasificación';
  if (/prec|cost|pvp|importe|margen|iva|descuento/.test(n)) return 'Precios';
  if (/lab|marca|fabric|proveedor|droguer/.test(n)) return 'Laboratorio';
  if (/stock|cant|unid|envase|frac/.test(n)) return 'Stock';
  if (/fecha|venc|modif|cread|actualiz/.test(n)) return 'Fechas';
  return 'Otros';
}

function formatCellDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function PadronProductoEditor({
  columns,
  primaryKey,
  values,
  onChange,
  readOnlyPk,
  catalogos,
}: {
  columns: PadronColumnMeta[];
  primaryKey: string;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  readOnlyPk?: boolean;
  /** Valores ya cargados por columna, para autocompletar y avisar de los nuevos. */
  catalogos?: Record<string, ValorCatalogo[]>;
}) {
  const [filter, setFilter] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PadronColumnMeta[]>();
    for (const col of columns) {
      const g = groupColumn(col.name);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(col);
    }
    const order = [
      'Identificación',
      'Clasificación',
      'Precios',
      'Laboratorio',
      'Stock',
      'Fechas',
      'Otros',
    ];
    return order
      .filter((g) => map.has(g))
      .map((g) => ({ group: g, cols: map.get(g)! }));
  }, [columns]);

  const term = filter.trim().toLowerCase();
  const filteredGroups = grouped.map(({ group, cols }) => ({
    group,
    cols: cols.filter(
      (c) =>
        !term ||
        c.name.toLowerCase().includes(term) ||
        formatCellDisplay(values[c.name]).toLowerCase().includes(term)
    ),
  })).filter((g) => g.cols.length > 0);

  const currentGroup =
    activeGroup && filteredGroups.some((g) => g.group === activeGroup)
      ? activeGroup
      : filteredGroups[0]?.group ?? null;

  const colsToShow =
    filteredGroups.find((g) => g.group === currentGroup)?.cols ?? [];

  const sincronizadas = columns.filter((c) => c.syncedFrom).length;

  return (
    <div className="flex flex-col gap-3">
      {sincronizadas > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {sincronizadas} campos vienen de Plex (plexdr) u Onze Center y se actualizan con el
            sync del padrón: se muestran bloqueados porque cualquier cambio manual se perdería
            en la próxima sincronización.
          </span>
        </p>
      )}
      <Input
        label="Filtrar campos"
        placeholder="Nombre de columna o valor…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {filteredGroups.map(({ group }) => (
          <button
            key={group}
            type="button"
            onClick={() => setActiveGroup(group)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium border ${
              currentGroup === group
                ? 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {group}
          </button>
        ))}
      </div>
      <div className="grid max-h-[min(70vh,560px)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {colsToShow.map((col) => {
          const isPk = col.name === primaryKey;
          // Las columnas que escribe el sync nunca se editan acá (el backend también las rechaza).
          const disabled = (isPk && readOnlyPk) || !!col.syncedFrom;
          const val = formatCellDisplay(values[col.name]);
          return (
            <div key={col.name} className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {col.name}
                {!col.isNullable && <span className="text-red-500"> *</span>}
                <span className="ml-1 font-normal normal-case text-gray-400">({col.dataType})</span>
                {col.syncedFrom && (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-0.5 font-normal normal-case text-gray-500"
                    title={`Se sincroniza desde ${etiquetaOrigenPadron(col.syncedFrom)}`}
                  >
                    <Lock className="h-3 w-3" />
                    {etiquetaOrigenPadron(col.syncedFrom)}
                  </span>
                )}
              </label>
              {!disabled && esColumnaConCatalogo(col.name) ? (
                <PadronCampoCatalogo
                  columna={col.name}
                  valor={val}
                  catalogo={catalogos?.[col.name] ?? []}
                  onChange={(nuevo) => onChange({ ...values, [col.name]: nuevo })}
                />
              ) : (
                <input
                  type="text"
                  disabled={disabled}
                  value={val}
                  onChange={(e) => onChange({ ...values, [col.name]: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-gray-100 disabled:text-gray-500"
                />
              )}
            </div>
          );
        })}
      </div>
      {filteredGroups.length === 0 && (
        <p className="text-sm text-gray-500">Ningún campo coincide con el filtro.</p>
      )}
    </div>
  );
}
