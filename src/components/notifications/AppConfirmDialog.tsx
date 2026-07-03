'use client';

import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AppConfirmVariant, PendingAppConfirm } from './app-confirm-types';

const VARIANT_STYLES: Record<
  AppConfirmVariant,
  { ring: string; icon: string; iconBg: string; confirm: 'primary' | 'danger' }
> = {
  default: {
    ring: 'ring-blue-500/20',
    icon: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950/60',
    confirm: 'primary',
  },
  warning: {
    ring: 'ring-amber-500/25',
    icon: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-950/60',
    confirm: 'primary',
  },
  danger: {
    ring: 'ring-red-500/25',
    icon: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-950/60',
    confirm: 'danger',
  },
};

type Props = {
  confirm: PendingAppConfirm | null;
  onAnswer: (value: boolean) => void;
};

export function AppConfirmDialog({ confirm, onAnswer }: Props) {
  if (!confirm) return null;

  const variant = confirm.variant ?? 'warning';
  const styles = VARIANT_STYLES[variant];
  const title = confirm.title?.trim() || 'Confirmar';

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 print:hidden"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="Cerrar"
        onClick={() => onAnswer(false)}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        aria-describedby="app-confirm-message"
        className={`app-notification-enter relative w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl ring-1 backdrop-blur-md dark:border-white/10 dark:bg-slate-900 ${styles.ring}`}
      >
        <div className="flex items-start gap-3 p-5">
          <div
            className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${styles.iconBg}`}
          >
            {variant === 'default' ? (
              <HelpCircle className={`h-6 w-6 ${styles.icon}`} aria-hidden />
            ) : (
              <AlertTriangle className={`h-6 w-6 ${styles.icon}`} aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p
              id="app-confirm-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              {title}
            </p>
            <p
              id="app-confirm-message"
              className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300"
            >
              {confirm.message}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4 sm:flex-row sm:justify-end dark:border-gray-800 dark:bg-slate-900/80">
          <Button type="button" variant="outline" onClick={() => onAnswer(false)}>
            {confirm.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            type="button"
            variant={styles.confirm === 'danger' ? 'danger' : 'primary'}
            onClick={() => onAnswer(true)}
          >
            {confirm.confirmLabel ?? 'Aceptar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
