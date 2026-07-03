'use client';

import { useMemo } from 'react';
import type { RolOperador } from '@/lib/auth/roles';
import ManualBookShell from '@/components/manual/ManualBookShell';
import { buildManualPages, manualPdfFileName } from '@/lib/manual/build-manual';
import { ROL_LABELS } from '@/lib/manual/content-map';

interface ManualBookClientProps {
  rol: RolOperador;
  permissions: string[];
}

export default function ManualBookClient({ rol, permissions }: ManualBookClientProps) {
  const { pages, cover } = useMemo(
    () => buildManualPages(rol, permissions),
    [rol, permissions],
  );

  const rolLabel = ROL_LABELS[rol] ?? rol;

  return (
    <ManualBookShell
      pages={pages}
      cover={cover}
      pdfFileName={manualPdfFileName(rol)}
      pdfPreviewTitle={`Manual Gestión Stock — ${rolLabel}`}
    />
  );
}
