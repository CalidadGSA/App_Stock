'use client';

import { useMemo } from 'react';
import type { RolOperador } from '@/lib/auth/roles';
import ManualBookShell from '@/components/manual/ManualBookShell';
import { buildManualPages, manualPdfFileName } from '@/lib/manual/build-manual';

interface ManualBookClientProps {
  rol: RolOperador;
  permissions: string[];
}

export default function ManualBookClient({ rol, permissions }: ManualBookClientProps) {
  const { pages, cover } = useMemo(
    () => buildManualPages(rol, permissions),
    [rol, permissions],
  );

  return (
    <ManualBookShell
      pages={pages}
      cover={cover}
      pdfFileName={manualPdfFileName(rol)}
    />
  );
}
