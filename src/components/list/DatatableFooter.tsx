'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  calcularRangoPaginacion,
  type TamPaginaDatatable,
} from '@/components/list/datatable-pagination';

interface DatatableFooterProps {
  paginaActual: number;
  onPaginaChange: (page: number) => void;
  totalFilas: number;
  tamPagina: TamPaginaDatatable;
  /** Texto adicional a la izquierda (p. ej. total de líneas). */
  detalle?: string;
  /** Acciones a la derecha, antes de la paginación (p. ej. aviso + botón masivo). */
  footerActions?: ReactNode;
}

export function DatatableFooter({
  paginaActual,
  onPaginaChange,
  totalFilas,
  tamPagina,
  detalle,
  footerActions,
}: DatatableFooterProps) {
  const { totalPaginas } = calcularRangoPaginacion(totalFilas, paginaActual, tamPagina);
  const pagina = Math.min(Math.max(paginaActual, 1), totalPaginas);
  const paginacionActiva = tamPagina !== 'all' && totalPaginas > 1;

  return (
    <div className="row-start-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-white px-2 py-2 text-sm print:hidden sm:px-3 dark:border-gray-800 dark:bg-slate-950">
      <p className="text-xs text-gray-600 dark:text-gray-300 sm:text-sm">
        {detalle ?? `${totalFilas} fila${totalFilas !== 1 ? 's' : ''}`}
        {paginacionActiva ? (
          <>
            {' '}
            · página{' '}
            <span className="font-semibold">{pagina}</span> de{' '}
            <span className="font-semibold">{totalPaginas}</span>
          </>
        ) : null}
      </p>
      {footerActions || paginacionActiva ? (
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {footerActions}
          {paginacionActiva ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPaginaChange(Math.max(1, pagina - 1))}
                disabled={pagina <= 1}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPaginaChange(Math.min(totalPaginas, pagina + 1))}
                disabled={pagina >= totalPaginas}
              >
                Siguiente
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
