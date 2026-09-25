'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

/** Botón de menú (Administración) para disparar sync legacy → Supabase. Solo UI; el caller filtra rol. */
export default function SidebarLegacySyncButton({
  onAfterClick,
}: {
  onAfterClick?: () => void;
}) {
  const notify = useAppNotify();
  const [running, setRunning] = useState(false);

  async function handleClick() {
    const ok = await notify.confirm({
      title: 'Sincronizar datos de la app',
      message:
        'Se sincronizarán sucursales, operadores, medicamentos, catálogos, laboratorios y Quantio (droguería) desde legacy hacia Supabase. Puede tardar varios minutos.',
      confirmLabel: 'Sincronizar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!ok) return;

    setRunning(true);
    try {
      const res = await fetch('/api/admin/sync-legacy', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        message?: string;
        error?: string;
      };

      if (res.status === 409 || json.code === 'ALREADY_RUNNING') {
        notify.error(json.message ?? 'Ya hay un sync en curso.');
        return;
      }

      if (!res.ok) {
        notify.error(json.error ?? json.message ?? 'No se pudo iniciar el sync.');
        return;
      }

      notify.success(
        json.message ??
          'Sync iniciado. Revisá los logs del servidor; al terminar los datos quedarán actualizados.'
      );
      onAfterClick?.();
    } catch {
      notify.error('No se pudo iniciar el sync.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={running}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
        running
          ? 'cursor-wait border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100'
          : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
      )}
      title="Sincronizar datos legacy → Supabase"
    >
      <RefreshCw
        className={cn(
          'h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400',
          running && 'animate-spin'
        )}
      />
      <span className="truncate text-left">
        {running ? 'Iniciando sync…' : 'Sincronizar app'}
      </span>
    </button>
  );
}
