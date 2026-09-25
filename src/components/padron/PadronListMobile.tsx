'use client';

import { Button } from '@/components/ui/button';

type Row = Record<string, unknown>;

export interface PadronListMobileProps {
  rows: Row[];
  /** Columnas visibles en la tabla desktop, en el mismo orden. */
  columns: string[];
  primaryKey: string;
  seleccionados: Set<string>;
  onToggleSeleccion: (pk: string) => void;
  onEditar: (pk: string) => void;
  formatCell: (value: unknown, max?: number) => string;
}

/**
 * Listado del padrón en cards para pantallas chicas: la tabla es `hidden md:block`
 * porque no entra en el ancho de un teléfono.
 */
export default function PadronListMobile({
  rows,
  columns,
  primaryKey,
  seleccionados,
  onToggleSeleccion,
  onEditar,
  formatCell,
}: PadronListMobileProps) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {rows.map((row) => {
        const pk = String(row[primaryKey] ?? '');
        const tildado = seleccionados.has(pk);
        const producto = 'producto' in row ? formatCell(row.producto, 120) : '';
        const resto = columns.filter((c) => c !== primaryKey && c !== 'producto');

        return (
          <article
            key={pk}
            className={`px-3 py-3 ${
              tildado ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'bg-white dark:bg-slate-900'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`Seleccionar ${pk}`}
                className="mt-1 shrink-0"
                checked={tildado}
                onChange={() => onToggleSeleccion(pk)}
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{pk}</p>
                {producto ? (
                  <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {producto}
                  </p>
                ) : null}
              </div>
              <Button size="sm" variant="outline" onClick={() => onEditar(pk)}>
                Editar
              </Button>
            </div>

            {resto.length > 0 ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 pl-7">
                {resto.map((col) => (
                  <div key={col} className="min-w-0">
                    <dt className="truncate text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {col}
                    </dt>
                    <dd
                      className="truncate text-sm text-gray-800 dark:text-gray-200"
                      title={formatCell(row[col], 200)}
                    >
                      {formatCell(row[col])}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
