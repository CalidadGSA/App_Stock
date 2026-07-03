/** Encabezado de columnas (sticky vía `.datatable-rows-scroll thead th` en globals.css). */
export const DATATABLE_STICKY_THEAD =
  'border-b border-gray-200 bg-gray-50 shadow-sm print:static dark:border-gray-700 dark:bg-slate-900';

/** Contenedor raíz de página listado: ocupa todo el alto del main (AppShell). */
export const DATATABLE_VIEWPORT_HEIGHT = 'min-h-0 flex-1';

/** Raíz de página con listado a pantalla completa (sin scroll del documento). */
export const DATATABLE_PAGE_ROOT = `flex min-h-0 flex-1 flex-col gap-3 overflow-hidden print:h-auto print:min-h-0 print:overflow-visible`;

export const DATATABLE_CARD_CLASS =
  'flex min-h-0 flex-1 flex-col overflow-hidden print:min-h-0 print:flex-none print:overflow-visible';

export const DATATABLE_CARD_BODY_CLASS =
  'flex min-h-0 flex-1 flex-col p-0 print:border-0 print:overflow-visible';

/** Cuerpo interno: grid toolbar | filas con scroll | footer fijo. */
export const DATATABLE_SECTION_CLASS =
  'grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden';

/** Encabezados de tabla más compactos en pantallas chicas. */
export const DATATABLE_TH =
  'px-1.5 py-1 text-left text-[11px] font-medium text-gray-600 sm:px-2 sm:py-1.5 sm:text-xs lg:px-2.5 lg:py-2 dark:text-gray-300';

export const DATATABLE_TD =
  'px-1.5 py-1 align-top text-[11px] sm:px-2 sm:py-1.5 sm:text-xs lg:px-2.5 lg:py-2';

/** Select compacto para filtros en la toolbar del datatable. */
export const DATATABLE_FILTER_SELECT =
  'h-7 min-w-[8.5rem] rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:h-8 sm:min-w-[9.5rem] sm:px-2.5 sm:text-sm dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100';

export const DATATABLE_FILTER_LABEL =
  'text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400';

export const DATATABLE_SCROLL_SCREEN =
  'datatable-screen-only row-start-2 hidden min-h-0 md:block';
