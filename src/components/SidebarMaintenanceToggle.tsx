'use client';

import { useEffect, useState } from 'react';
import { Construction } from 'lucide-react';
import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

export default function SidebarMaintenanceToggle({
  rol,
  onAfterClick,
}: {
  rol: RolOperador;
  onAfterClick?: () => void;
}) {
  const notify = useAppNotify();
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [changingMaintenance, setChangingMaintenance] = useState(false);

  const esSuperadmin = isSuperAdminRole(rol);

  useEffect(() => {
    if (!esSuperadmin) return;

    async function cargarEstadoMantenimiento() {
      try {
        const res = await fetch('/api/admin/maintenance');
        const json = await res.json();
        if (res.ok) {
          setMaintenanceActive(Boolean(json?.maintenance));
        }
      } catch {
        // Mantener último estado conocido.
      }
    }

    void cargarEstadoMantenimiento();
    const intervalId = window.setInterval(() => void cargarEstadoMantenimiento(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [esSuperadmin]);

  async function handleToggleMaintenance() {
    if (!esSuperadmin) return;

    const next = !maintenanceActive;
    const ok = await notify.confirm({
      title: 'Modo mantenimiento',
      message: next
        ? '¿Activar modo mantenimiento?'
        : '¿Desactivar modo mantenimiento?',
      confirmLabel: next ? 'Activar' : 'Desactivar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!ok) return;

    setChangingMaintenance(true);
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next ? 1 : 0 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(json?.error ?? 'No se pudo cambiar el modo mantenimiento.');
        return;
      }
      setMaintenanceActive(Boolean(json?.maintenance));
      onAfterClick?.();
    } catch {
      notify.error('No se pudo cambiar el modo mantenimiento.');
    } finally {
      setChangingMaintenance(false);
    }
  }

  if (!esSuperadmin) return null;

  const label = changingMaintenance
    ? 'Actualizando…'
    : maintenanceActive
      ? 'Desactivar mantenimiento'
      : 'Activar mantenimiento';

  return (
    <div>
      <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Sistema
      </p>
      <ul className="flex flex-col gap-0.5">
        <li>
          <button
            type="button"
            onClick={() => void handleToggleMaintenance()}
            disabled={changingMaintenance}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
              maintenanceActive
                ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60'
                : 'border-orange-300 text-gray-700 hover:bg-gray-100 dark:border-orange-600/80 dark:text-gray-200 dark:hover:bg-gray-800'
            )}
            title={label}
          >
            <Construction
              className={cn(
                'h-4 w-4 shrink-0',
                maintenanceActive
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-orange-500 dark:text-orange-400'
              )}
            />
            <span className="truncate text-left">{label}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
