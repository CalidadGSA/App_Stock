'use client';

import type { ReactNode } from 'react';

/**
 * Zona central del DataTable: toolbar y footer quedan fuera (grid del section).
 * Solo las filas scrollean; el thead queda sticky (ver `.datatable-rows-scroll` en globals.css).
 */
export function DatatableScrollArea({
  children,
  className = '',
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  const sizeClass = fill
    ? 'h-full min-h-0 max-h-full w-full'
    : 'max-h-[min(70vh,calc(100dvh-13rem))] min-h-[200px]';

  return (
    <div
      className={`datatable-rows-scroll ${sizeClass} print:max-h-none print:min-h-0 print:h-auto print:overflow-visible ${className}`}
    >
      {children}
    </div>
  );
}
