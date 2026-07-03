'use client';

import type { ReactNode } from 'react';
import { DatatableScrollArea } from '@/components/list/DatatableScrollArea';

/**
 * @deprecated Preferir DatatableScrollArea con fill={true} en layouts DataTable.
 */
export function VencimientosTablaContenedor({
  children,
  className = '',
  fill = true,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <DatatableScrollArea className={className} fill={fill}>
      {children}
    </DatatableScrollArea>
  );
}
