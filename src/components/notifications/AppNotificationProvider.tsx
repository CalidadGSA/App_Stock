'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppNotification, AppNotifyInput, AppNotificationVariant } from './app-notification-types';
import type { AppConfirmOptions, PendingAppConfirm } from './app-confirm-types';
import { AppNotificationHost } from './AppNotificationHost';
import { AppConfirmDialog } from './AppConfirmDialog';

type NotifyFn = (input: AppNotifyInput) => string;

type ConfirmFn = (options: AppConfirmOptions | string) => Promise<boolean>;

type AppNotifyApi = {
  notify: NotifyFn;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
  confirm: ConfirmFn;
};

const DEFAULT_DURATION: Record<AppNotificationVariant, number> = {
  success: 3150,
  info: 3150,
  warning: 4125,
  error: 5250,
};

const AppNotificationContext = createContext<AppNotifyApi | null>(null);

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AppNotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAppConfirm | null>(null);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback<NotifyFn>(
    (input) => {
      const variant = input.variant ?? 'info';
      const id = makeId();
      const durationMs = input.durationMs ?? DEFAULT_DURATION[variant];
      const next: AppNotification = {
        id,
        variant,
        title: input.title,
        message: input.message,
        durationMs,
      };

      setItems((prev) => [...prev.slice(-2), next]);

      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);

      return id;
    },
    [dismiss]
  );

  const confirm = useCallback<ConfirmFn>((options) => {
    const opts: AppConfirmOptions =
      typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({
        id: makeId(),
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        variant: opts.variant,
        resolve,
      });
    });
  }, []);

  const answerConfirm = useCallback((value: boolean) => {
    setPendingConfirm((current) => {
      if (current) current.resolve(value);
      return null;
    });
  }, []);

  const api = useMemo<AppNotifyApi>(
    () => ({
      notify,
      success: (message, title) => notify({ variant: 'success', message, title }),
      error: (message, title) => notify({ variant: 'error', message, title }),
      warning: (message, title) => notify({ variant: 'warning', message, title }),
      info: (message, title) => notify({ variant: 'info', message, title }),
      dismiss,
      confirm,
    }),
    [notify, dismiss, confirm]
  );

  return (
    <AppNotificationContext.Provider value={api}>
      {children}
      <AppNotificationHost items={items} onDismiss={dismiss} />
      <AppConfirmDialog confirm={pendingConfirm} onAnswer={answerConfirm} />
    </AppNotificationContext.Provider>
  );
}

export function useAppNotify(): AppNotifyApi {
  const ctx = useContext(AppNotificationContext);
  if (!ctx) {
    throw new Error('useAppNotify debe usarse dentro de AppNotificationProvider');
  }
  return ctx;
}
