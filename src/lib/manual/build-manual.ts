import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import { getVisibleNavSections } from '@/lib/navigation/app-nav';
import {
  MANUAL_NAV_CONTENT,
  MANUAL_STATIC_PAGES,
  ROL_LABELS,
} from '@/lib/manual/content-map';
import type { ManualCoverMeta, ManualPageDef } from '@/lib/manual/types';

const STATIC_ORDER = ['portada', 'introduccion', 'acceso', 'navegacion'] as const;

export function buildManualPages(
  rol: RolOperador,
  permissions: string[],
): { pages: ManualPageDef[]; cover: ManualCoverMeta } {
  const sections = getVisibleNavSections(rol, permissions);
  const moduleLabels = sections.map((s) => s.label);

  const pages: ManualPageDef[] = [];

  for (const key of STATIC_ORDER) {
    const def = MANUAL_STATIC_PAGES[key];
    pages.push({ ...def, blocks: [...def.blocks] });
  }

  for (const section of sections) {
    for (const item of section.items) {
      const content = MANUAL_NAV_CONTENT[item.id];
      if (content) {
        pages.push({ ...content, blocks: [...content.blocks] });
      }
    }
  }

  if (isSuperAdminRole(rol)) {
    pages.push({
      id: 'sistema',
      label: 'Sistema',
      eyebrow: 'Superadmin',
      title: 'Mantenimiento',
      blocks: [
        {
          type: 'paragraph',
          text: 'Como superadministrador podés activar el modo mantenimiento desde el menú lateral. Mientras esté activo, los operadores de sucursal no pueden hacer inventarios diarios.',
        },
        {
          type: 'list',
          items: [
          ],
        },
      ],
    });
  }

  const faq = MANUAL_STATIC_PAGES.faq;
  pages.push({ ...faq, blocks: [...faq.blocks] });

  const cover: ManualCoverMeta = {
    rolLabel: ROL_LABELS[rol] ?? rol,
    edition: new Date().getFullYear().toString(),
    modules: moduleLabels,
  };

  return { pages, cover };
}

export function manualPdfFileName(rol: RolOperador): string {
  return `manual-gestion-stock-${rol}.pdf`;
}
