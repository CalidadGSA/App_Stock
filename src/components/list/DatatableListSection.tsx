'use client';

import type { ReactNode } from 'react';
import { PageSpinner } from '@/components/ui/spinner';
import { DatatableFooter } from '@/components/list/DatatableFooter';
import { DatatableScrollArea } from '@/components/list/DatatableScrollArea';
import { DatatableToolbar } from '@/components/list/DatatableToolbar';
import type { TamPaginaDatatable } from '@/components/list/datatable-pagination';
import {
  DATATABLE_SCROLL_SCREEN,
  DATATABLE_SECTION_CLASS,
} from '@/components/list/datatable-classes';

export interface DatatableListSectionProps {
  busquedaTexto: string;
  onBusquedaChange: (value: string) => void;
  tamPagina: TamPaginaDatatable;
  onTamPaginaChange: (value: TamPaginaDatatable) => void;
  paginaActual: number;
  onPaginaChange: (page: number) => void;
  totalFilas: number;
  searchPlaceholder?: string;
  footerDetalle?: string;
  /** Acciones en el footer (a la derecha, junto a paginación). */
  footerActions?: ReactNode;
  hideSearch?: boolean;
  hidePageSize?: boolean;
  /** Filtros en la toolbar del datatable (segunda fila). */
  toolbarFilters?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: ReactNode;
  /** Contenido mobile (cards) — scroll propio en md:hidden. */
  mobile?: ReactNode;
  /** Tabla desktop — filas con scroll; toolbar y footer fijos (grid). */
  table: ReactNode;
  /** Bloque solo impresión u oculto en pantalla. */
  printOnly?: ReactNode;
  /** Clase extra del contenedor scroll desktop. */
  tableScrollClassName?: string;
}

/**
 * Cuerpo estándar de listado: toolbar fijo + scroll en tabla + footer fijo.
 */
export function DatatableListSection({
  busquedaTexto,
  onBusquedaChange,
  tamPagina,
  onTamPaginaChange,
  paginaActual,
  onPaginaChange,
  totalFilas,
  searchPlaceholder,
  footerDetalle,
  footerActions,
  hideSearch,
  hidePageSize,
  toolbarFilters,
  loading,
  error,
  empty,
  emptyMessage,
  mobile,
  table,
  printOnly,
  tableScrollClassName = DATATABLE_SCROLL_SCREEN,
}: DatatableListSectionProps) {
  if (loading) {
    return (
      <div className={DATATABLE_SECTION_CLASS}>
        <DatatableToolbar
          busquedaTexto={busquedaTexto}
          onBusquedaChange={onBusquedaChange}
          tamPagina={tamPagina}
          onTamPaginaChange={onTamPaginaChange}
          paginaActual={paginaActual}
          onPaginaChange={onPaginaChange}
          totalFilas={totalFilas}
          searchPlaceholder={searchPlaceholder}
          hideSearch={hideSearch}
          hidePageSize={hidePageSize}
          toolbarFilters={toolbarFilters}
        />
        <div className="row-start-2 flex flex-1 items-center justify-center py-6">
          <PageSpinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={DATATABLE_SECTION_CLASS}>
        <p className="shrink-0 px-3 py-4 text-sm text-red-600 sm:px-4 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className={DATATABLE_SECTION_CLASS}>
      <DatatableToolbar
        busquedaTexto={busquedaTexto}
        onBusquedaChange={onBusquedaChange}
        tamPagina={tamPagina}
        onTamPaginaChange={onTamPaginaChange}
        paginaActual={paginaActual}
        onPaginaChange={onPaginaChange}
        totalFilas={totalFilas}
        searchPlaceholder={searchPlaceholder}
        hideSearch={hideSearch}
        hidePageSize={hidePageSize}
        toolbarFilters={toolbarFilters}
      />
      {empty ? (
        <p className="row-start-2 shrink-0 px-3 py-3 text-sm text-gray-400 sm:px-4 dark:text-gray-500">
          {emptyMessage}
        </p>
      ) : (
        <>
          {mobile ? (
            <div className="datatable-rows-scroll row-start-2 min-h-0 overflow-auto overscroll-contain px-0 md:hidden print:hidden">
              {mobile}
            </div>
          ) : null}
          {printOnly}
          <DatatableScrollArea fill className={tableScrollClassName}>
            {table}
          </DatatableScrollArea>
          <DatatableFooter
            paginaActual={paginaActual}
            onPaginaChange={onPaginaChange}
            totalFilas={totalFilas}
            tamPagina={tamPagina}
            detalle={footerDetalle}
            footerActions={footerActions}
          />
        </>
      )}
    </div>
  );
}
