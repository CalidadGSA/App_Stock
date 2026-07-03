'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  calcularRangoPaginacion,
  OPCIONES_TAM_PAGINA_DATATABLE,
  type TamPaginaDatatable,
} from '@/components/list/datatable-pagination';

interface DatatableToolbarProps {
  busquedaTexto: string;
  onBusquedaChange: (value: string) => void;
  tamPagina: TamPaginaDatatable;
  onTamPaginaChange: (value: TamPaginaDatatable) => void;
  paginaActual: number;
  onPaginaChange: (page: number) => void;
  totalFilas: number;
  searchPlaceholder?: string;
  compact?: boolean;
  /** Ocultar búsqueda (p. ej. paginación servidor con búsqueda aparte). */
  hideSearch?: boolean;
  /** Ocultar selector de filas por página. */
  hidePageSize?: boolean;
  /** Filtros adicionales (segunda fila de la toolbar). */
  toolbarFilters?: ReactNode;
}

export function DatatableToolbar({
  busquedaTexto,
  onBusquedaChange,
  tamPagina,
  onTamPaginaChange,
  paginaActual,
  onPaginaChange,
  totalFilas,
  searchPlaceholder = 'Buscar… (Enter)',
  compact = true,
  hideSearch = false,
  hidePageSize = false,
  toolbarFilters,
}: DatatableToolbarProps) {
  const { inicio, fin, totalPaginas } = calcularRangoPaginacion(
    totalFilas,
    paginaActual,
    tamPagina
  );
  const pagina = Math.min(Math.max(paginaActual, 1), totalPaginas);
  const paginacionActiva = tamPagina !== 'all' && totalPaginas > 1;
  const [busquedaBorrador, setBusquedaBorrador] = useState(busquedaTexto);

  useEffect(() => {
    setBusquedaBorrador(busquedaTexto);
  }, [busquedaTexto]);

  function aplicarBusqueda() {
    onBusquedaChange(busquedaBorrador);
  }

  return (
    <div
      className={`row-start-1 shrink-0 border-b border-gray-100 bg-gray-50 print:hidden dark:border-gray-800 dark:bg-slate-900/80 ${
        compact ? 'px-2 py-1.5 sm:px-3 sm:py-2' : 'px-4 py-2.5'
      }`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!hidePageSize ? (
            <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="whitespace-nowrap font-medium">Mostrar</span>
              <select
                value={String(tamPagina)}
                onChange={(e) => {
                  const raw = e.target.value;
                  const next: TamPaginaDatatable =
                    raw === 'all' ? 'all' : (Number(raw) as 20 | 50 | 100);
                  onTamPaginaChange(next);
                }}
                className="h-7 rounded-md border border-gray-300 bg-white px-1.5 text-xs text-gray-900 sm:h-8 sm:px-2 sm:text-sm dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
              >
                {OPCIONES_TAM_PAGINA_DATATABLE.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="whitespace-nowrap">filas</span>
            </label>
          ) : null}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {totalFilas === 0 ? (
              'Sin filas'
            ) : (
              <>
                Mostrando{' '}
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {inicio}–{fin}
                </span>{' '}
                de{' '}
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {totalFilas}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hideSearch ? (
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs lg:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={busquedaBorrador}
                onChange={(e) => setBusquedaBorrador(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    aplicarBusqueda();
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-7 w-full rounded-md border border-gray-300 bg-white py-0.5 pl-7 pr-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:h-8 sm:pl-8 sm:pr-3 sm:text-sm dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </div>
          ) : null}
          {paginacionActiva ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => onPaginaChange(Math.max(1, pagina - 1))}
                disabled={pagina <= 1}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[5.5rem] text-center text-xs text-gray-600 dark:text-gray-300">
                {pagina} / {totalPaginas}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => onPaginaChange(Math.min(totalPaginas, pagina + 1))}
                disabled={pagina >= totalPaginas}
                aria-label="Página siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {toolbarFilters ? (
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-gray-100 pt-2 dark:border-gray-800">
          {toolbarFilters}
        </div>
      ) : null}
    </div>
  );
}
