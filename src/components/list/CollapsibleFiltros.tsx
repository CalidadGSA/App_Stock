'use client';

import type { ReactNode } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FiltrosToggleButton({
  abierto,
  onClick,
  activos = 0,
  className,
}: {
  abierto: boolean;
  onClick: () => void;
  /** Cantidad de filtros activos (badge). */
  activos?: number;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={abierto ? 'secondary' : 'outline'}
      onClick={onClick}
      className={className}
    >
      <Filter className="mr-1 h-4 w-4" />
      Filtros
      {activos > 0 ? (
        <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
          {activos}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * Overlay de filtros (mismo patrón que «Por vencer»):
 * backdrop + panel absoluto sobre el listado.
 * El padre debe tener `relative` y altura suficiente.
 */
export function CollapsibleFiltrosPanel({
  abierto,
  onCerrar,
  titulo = 'Filtros',
  descripcion,
  children,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  descripcion?: ReactNode;
  children: ReactNode;
}) {
  if (!abierto) return null;

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-20 bg-black/40 print:hidden"
        aria-label="Cerrar filtros"
        onClick={onCerrar}
      />
      <div className="absolute inset-x-0 top-0 z-30 max-h-full overflow-y-auto rounded-b-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-slate-900 print:hidden">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{titulo}</p>
            {descripcion ? (
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{descripcion}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Cerrar filtros"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
    </>
  );
}
