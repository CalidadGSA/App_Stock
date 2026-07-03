'use client';

import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import type { AppNotification, AppNotificationVariant } from './app-notification-types';

const VARIANT_STYLES: Record<
  AppNotificationVariant,
  { ring: string; icon: string; iconBg: string; title: string; body: string }
> = {
  success: {
    ring: 'ring-emerald-500/25',
    icon: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950/60',
    title: 'text-emerald-950 dark:text-emerald-50',
    body: 'text-emerald-900/90 dark:text-emerald-100/90',
  },
  error: {
    ring: 'ring-red-500/25',
    icon: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-950/60',
    title: 'text-red-950 dark:text-red-50',
    body: 'text-red-900/90 dark:text-red-100/90',
  },
  warning: {
    ring: 'ring-amber-500/25',
    icon: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-950/60',
    title: 'text-amber-950 dark:text-amber-50',
    body: 'text-amber-900/90 dark:text-amber-100/90',
  },
  info: {
    ring: 'ring-blue-500/25',
    icon: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950/60',
    title: 'text-blue-950 dark:text-blue-50',
    body: 'text-blue-900/90 dark:text-blue-100/90',
  },
};

function VariantIcon({ variant }: { variant: AppNotificationVariant }) {
  const cls = `h-6 w-6 shrink-0 ${VARIANT_STYLES[variant].icon}`;
  if (variant === 'success') return <CheckCircle2 className={cls} aria-hidden />;
  if (variant === 'error') return <AlertCircle className={cls} aria-hidden />;
  if (variant === 'warning') return <AlertTriangle className={cls} aria-hidden />;
  return <Info className={cls} aria-hidden />;
}

function defaultTitle(variant: AppNotificationVariant): string {
  if (variant === 'success') return 'Listo';
  if (variant === 'error') return 'Error';
  if (variant === 'warning') return 'Atención';
  return 'Aviso';
}

type Props = {
  items: AppNotification[];
  onDismiss: (id: string) => void;
};

export function AppNotificationHost({ items, onDismiss }: Props) {
  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center p-4 print:hidden"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="flex w-full max-w-md flex-col gap-3">
        {items.map((item) => {
          const styles = VARIANT_STYLES[item.variant];
          const title = item.title?.trim() || defaultTitle(item.variant);
          return (
            <div
              key={item.id}
              role="alert"
              className={`app-notification-enter pointer-events-auto overflow-hidden rounded-2xl border border-white/20 bg-white/95 shadow-2xl ring-1 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95 ${styles.ring}`}
            >
              <div className="flex items-start gap-3 p-4">
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.iconBg}`}
                >
                  <VariantIcon variant={item.variant} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className={`text-sm font-semibold ${styles.title}`}>{title}</p>
                  <p className={`mt-1 text-sm leading-relaxed ${styles.body}`}>{item.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  className="shrink-0 rounded-lg p-1.5 text-gray-500 transition hover:bg-black/5 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
                  aria-label="Cerrar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-1 w-full bg-black/5 dark:bg-white/5">
                <div
                  className={`app-notification-progress h-full ${
                    item.variant === 'success'
                      ? 'bg-emerald-500'
                      : item.variant === 'error'
                        ? 'bg-red-500'
                        : item.variant === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                  }`}
                  style={{ animationDuration: `${item.durationMs}ms` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
