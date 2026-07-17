import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  BookOpen,
  ClipboardPlus,
  ClipboardList,
  Search,
  TrendingDown,
  CalendarPlus,
  CalendarClock,
  CalendarRange,
  PackageX,
  Undo2,
  Percent,
  Layers,
  SlidersHorizontal,
  History,
  BarChart3,
  Pill,
  Shield,
  FileUp,
  Table2,
  RotateCcw,
} from 'lucide-react';
import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import { legacyPermissionsForRol } from '@/lib/auth/permissions-catalog';

export interface AppNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permiso requerido (prioridad sobre flags legacy). */
  permission?: string;
  /** @deprecated Usar permission */
  roles?: RolOperador[];
  /** @deprecated Usar permission */
  operadorOnly?: boolean;
  /** @deprecated Usar permission */
  adminOnly?: boolean;
  /** Permiso admin.maintenance o rol superadmin */
  superadminOnly?: boolean;
  /** Desactivar enlace cuando la app está en modo mantenimiento. */
  disabledInMaintenance?: boolean;
}

export interface AppNavSection {
  id: string;
  label: string;
  items: AppNavItem[];
}

export const APP_NAV_SECTIONS: AppNavSection[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permission: 'dashboard.view',
      },
      {
        id: 'manual',
        label: 'Manual de usuario',
        href: '/manual',
        icon: BookOpen,
        permission: 'dashboard.view',
      },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    items: [
      {
        id: 'inventario-nuevo',
        label: 'Inventario diario',
        href: '/inventario/nuevo',
        icon: ClipboardPlus,
        permission: 'inventario.diario',
        disabledInMaintenance: true,
      },
      {
        id: 'inventario-ocasional',
        label: 'Inventario ocasional',
        href: '/inventario/ocasional',
        icon: ClipboardList,
        permission: 'inventario.ocasional',
        disabledInMaintenance: true,
      },
      {
        id: 'inventario-auditoria',
        label: 'Auditoría de stock',
        href: '/inventario/auditoria',
        icon: Search,
        permission: 'inventario.auditoria',
      },
      {
        id: 'inventario-auditoria-sorpresa',
        label: 'Auditoría integral',
        href: '/inventario/auditoria-sorpresa',
        icon: FileUp,
        permission: 'inventario.auditoria',
      },
      {
        id: 'inventario-diferencias-auditoria',
        label: 'Diferencias de auditoría',
        href: '/inventario/diferencias-auditoria',
        icon: TrendingDown,
        permission: 'inventario.auditoria',
      },
      {
        id: 'inventario-lista',
        label: 'Controles de inventario',
        href: '/inventario',
        icon: ClipboardList,
        permission: 'inventario.lista',
      },
      {
        id: 'inventario-diferencias',
        label: 'Resumen de diferencias',
        href: '/inventario/diferencias-resumen',
        icon: TrendingDown,
        permission: 'inventario.diferencias_resumen',
      },
      {
        id: 'inventario-diferencias-consolidado',
        label: 'Diferencias consolidado',
        href: '/inventario/diferencias-consolidado',
        icon: TrendingDown,
        permission: 'inventario.diferencias_consolidado',
      },
    ],
  },
  {
    id: 'vencimientos',
    label: 'Vencimientos',
    items: [
      {
        id: 'vencimientos-nuevo',
        label: 'Control de vencimientos',
        href: '/vencimientos/nuevo',
        icon: CalendarPlus,
        permission: 'vencimientos.nuevo',
      },
      {
        id: 'vencimientos-lista',
        label: 'Controles de vencimientos',
        href: '/vencimientos',
        icon: CalendarClock,
        permission: 'vencimientos.lista',
      },
      {
        id: 'vencimientos-por-vencer',
        label: 'Por vencer',
        href: '/vencimientos/por-vencer?days=365&daysMin=0',
        icon: CalendarClock,
        permission: 'vencimientos.por_vencer',
      },
      {
        id: 'vencimientos-consolidado',
        label: 'Por vencer consolidado',
        href: '/vencimientos/por-vencer/consolidado?consolidado=1&days=365&daysMin=0',
        icon: Layers,
        permission: 'vencimientos.consolidado',
      },
      {
        id: 'vencimientos-para-devolver',
        label: 'Productos para devolver',
        href: '/vencimientos/para-devolver',
        icon: Undo2,
        permission: 'vencimientos.vencidos',
      },
      {
        id: 'vencimientos-devoluciones',
        label: 'Historial de Devoluciones',
        href: '/vencimientos/devoluciones',
        icon: PackageX,
        permission: 'vencimientos.devoluciones',
      },
      {
        id: 'vencimientos-descuentos',
        label: 'Descuentos',
        href: '/vencimientos/descuentos',
        icon: Percent,
        permission: 'vencimientos.descuentos',
      },
    ],
  },
  {
    id: 'administracion',
    label: 'Administración',
    items: [
      {
        id: 'resumen-trimestral',
        label: 'Resumen trimestral',
        href: '/admin/resumen-trimestral',
        icon: BarChart3,
        permission: 'admin.resumen_trimestral',
      },
      {
        id: 'vueltas-psicos',
        label: 'Vueltas psicotrópicos',
        href: '/admin/vueltas-psicos',
        icon: RotateCcw,
        permission: 'admin.resumen_trimestral',
      },
      {
        id: 'informe-mensual',
        label: 'Informe mensual',
        href: '/admin/informe-mensual',
        icon: CalendarRange,
        permission: 'admin.informe_mensual_sucursales',
      },
      {
        id: 'diferencias-psico-ocasional',
        label: 'Dif. psico / estupefacientes',
        href: '/admin/diferencias-psico-ocasional',
        icon: Pill,
        permission: 'admin.diferencias_psico',
      },
      {
        id: 'ajustes',
        label: 'Ajustes',
        href: '/ajustes',
        icon: SlidersHorizontal,
        permission: 'admin.ajustes',
      },
      {
        id: 'ajustes-historial',
        label: 'Historial de ajustes',
        href: '/ajustes/historial',
        icon: History,
        permission: 'admin.ajustes_historial',
      },
      {
        id: 'roles-permisos',
        label: 'Roles y permisos',
        href: '/admin/roles',
        icon: Shield,
        permission: 'admin.roles_manage',
      },
      {
        id: 'padron-productos',
        label: 'Padrón productos',
        href: '/admin/padron-productos',
        icon: Table2,
        permission: 'admin.padron_productos',
      },
    ],
  },
];

function permSet(permissions: string[] | undefined, rol: RolOperador): Set<string> {
  if (permissions && permissions.length > 0) return new Set(permissions);
  return legacyPermissionsForRol(rol);
}

function hasNavPermission(
  permissions: string[] | undefined,
  rol: RolOperador,
  codigo: string,
): boolean {
  if (isSuperAdminRole(rol)) return true;
  return permSet(permissions, rol).has(codigo);
}

export function canSeeNavItem(
  rol: RolOperador,
  item: AppNavItem,
  permissions?: string[],
): boolean {
  if (item.superadminOnly) {
    return (
      isSuperAdminRole(rol) || hasNavPermission(permissions, rol, 'admin.maintenance')
    );
  }

  if (item.permission) {
    return hasNavPermission(permissions, rol, item.permission);
  }

  if (item.roles && item.roles.length > 0) return item.roles.includes(rol);
  return true;
}

export function getVisibleNavSections(
  rol: RolOperador,
  permissions?: string[],
): AppNavSection[] {
  return APP_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSeeNavItem(rol, item, permissions)),
  })).filter((section) => section.items.length > 0);
}

const INVENTARIO_NAV_PREFIXES = [
  '/inventario',
  '/inventario/nuevo',
  '/inventario/ocasional',
  '/inventario/auditoria',
  '/inventario/auditoria-sorpresa',
  '/inventario/diferencias-resumen',
  '/inventario/diferencias-auditoria',
  '/inventario/diferencias-consolidado',
];

const VENCIMIENTOS_NAV_PREFIXES = [
  '/vencimientos',
  '/vencimientos/nuevo',
  '/vencimientos/por-vencer',
  '/vencimientos/para-devolver',
  '/vencimientos/vencidos',
  '/vencimientos/devoluciones',
  '/vencimientos/descuentos',
];

function isActiveScanControl(pathname: string, prefixes: string[]): boolean {
  const base = prefixes[0];
  if (!pathname.startsWith(`${base}/`)) return false;
  return !prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Ocultar menú lateral durante controles activos de escaneo (p. ej. /inventario/[id]). */
export function shouldHideAppNav(pathname: string): boolean {
  return (
    isActiveScanControl(pathname, INVENTARIO_NAV_PREFIXES) ||
    isActiveScanControl(pathname, VENCIMIENTOS_NAV_PREFIXES)
  );
}

export function navItemPath(href: string): string {
  return href.split('?')[0] ?? href;
}

/** Ítem activo: coincide la ruta más específica visible. */
export function getActiveNavItemId(pathname: string, sections: AppNavSection[]): string | null {
  const flat = sections.flatMap((s) => s.items);
  let best: { id: string; len: number } | null = null;

  for (const item of flat) {
    const path = navItemPath(item.href);
    const matches =
      pathname === path ||
      (path !== '/' && pathname.startsWith(`${path}/`));
    if (matches && (!best || path.length > best.len)) {
      best = { id: item.id, len: path.length };
    }
  }

  return best?.id ?? null;
}
