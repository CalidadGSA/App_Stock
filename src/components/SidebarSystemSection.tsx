'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Construction, MonitorOff } from 'lucide-react';
import type { RolOperador } from '@/lib/auth/roles';
import { isSuperAdminRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

export default function SidebarSystemSection({
  rol,
  permissions,
  onAfterClick,
}: {
  rol: RolOperador;
  /** Permisos efectivos del operador (incluye los ajustes individuales). */
  permissions?: string[];
  onAfterClick?: () => void;
}) {
  const notify = useAppNotify();
  const pathname = usePathname();
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [changingMaintenance, setChangingMaintenance] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  const esSuperadmin = isSuperAdminRole(rol);
  // El superadmin siempre puede; para el resto depende del permiso.
  const puedeRevocarSesiones = esSuperadmin || (permissions ?? []).includes('sesiones.revocar');
  const rendimientoActivo = pathname === '/admin/rendimiento' || pathname.startsWith('/admin/rendimiento/');

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

  async function handleRevokeOtherSessions() {
    const ok = await notify.confirm({
      title: 'Cerrar sesión en otros dispositivos',
      message:
        'Se cerrará la sesión de esta cuenta en todos los demás dispositivos. Este dispositivo seguirá conectado.',
      confirmLabel: 'Cerrar en otros',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!ok) return;

    setRevokingSessions(true);
    try {
      const res = await fetch('/api/auth/revoke-other-sessions', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(json?.error ?? 'No se pudo cerrar las otras sesiones.');
        return;
      }
      notify.success(
        json?.message ??
          'Se cerró la sesión en los demás dispositivos. Este dispositivo sigue conectado.'
      );
      onAfterClick?.();
    } catch {
      notify.error('No se pudo cerrar las otras sesiones.');
    } finally {
      setRevokingSessions(false);
    }
  }

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

  const maintenanceLabel = changingMaintenance
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
        {esSuperadmin ? (
          <li>
            <Link
              href="/admin/rendimiento"
              onClick={onAfterClick}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                rendimientoActivo
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
              )}
              aria-current={rendimientoActivo ? 'page' : undefined}
              title="Rendimiento"
            >
              <Activity
                className={cn(
                  'h-4 w-4 shrink-0',
                  rendimientoActivo ? 'text-white' : 'text-gray-500 dark:text-gray-400'
                )}
              />
              <span className="truncate">Rendimiento</span>
            </Link>
          </li>
        ) : null}
        {puedeRevocarSesiones ? (
        <li>
          <button
            type="button"
            onClick={() => void handleRevokeOtherSessions()}
            disabled={revokingSessions}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            title="Cerrar sesión en otros dispositivos"
          >
            <MonitorOff className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
            <span className="truncate text-left">
              {revokingSessions ? 'Cerrando…' : 'Cerrar sesión en otros dispositivos'}
            </span>
          </button>
        </li>
        ) : null}
        {esSuperadmin ? (
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
              title={maintenanceLabel}
            >
              <Construction
                className={cn(
                  'h-4 w-4 shrink-0',
                  maintenanceActive
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-orange-500 dark:text-orange-400'
                )}
              />
              <span className="truncate text-left">{maintenanceLabel}</span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
