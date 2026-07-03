'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, X } from 'lucide-react';
import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import {
  getActiveNavItemId,
  getVisibleNavSections,
} from '@/lib/navigation/app-nav';
import { cn } from '@/lib/utils';
import { useMaintenanceStatus } from '@/components/MaintenanceGuard';
import SidebarMaintenanceToggle from '@/components/SidebarMaintenanceToggle';

interface AppSidebarProps {
  rol: RolOperador;
  permissions: string[];
  nombreSucursal: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function AppSidebar({
  rol,
  permissions,
  nombreSucursal,
  mobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { maintenance } = useMaintenanceStatus();
  const sections = getVisibleNavSections(rol, permissions);
  const activeId = getActiveNavItemId(pathname, sections);

  const sucursalNombre = nombreSucursal.trim() || 'Sucursal';

  const navContent = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {section.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.id === activeId;
              const disabled = maintenance && item.disabledInMaintenance === true;
              const Icon = item.icon;

              if (disabled) {
                return (
                  <li key={item.id}>
                    <span
                      className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 dark:text-gray-600"
                      title="No disponible en modo mantenimiento"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-600" />
                      <span className="truncate">{item.label}</span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onMobileClose}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.label}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-white' : 'text-gray-500 dark:text-gray-400'
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {isSuperAdminRole(rol) ? (
        <div className="mt-auto">
          <SidebarMaintenanceToggle rol={rol} onAfterClick={onMobileClose} />
        </div>
      ) : null}
    </nav>
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Cerrar menú"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-gray-200 bg-white pt-14 shadow-xl transition-transform duration-200 dark:border-gray-800 dark:bg-gray-950 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Menú principal"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
              <p
                className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
                title={sucursalNombre}
              >
                {sucursalNombre}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onMobileClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{navContent}</div>
      </aside>

      <aside
        className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-gray-50/80 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] dark:lg:border-gray-800 dark:lg:bg-gray-950/50"
        aria-label="Menú principal"
      >
        {navContent}
      </aside>
    </>
  );
}
