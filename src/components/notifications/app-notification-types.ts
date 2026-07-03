export type AppNotificationVariant = 'success' | 'error' | 'warning' | 'info';

export type AppNotification = {
  id: string;
  variant: AppNotificationVariant;
  title?: string;
  message: string;
  durationMs: number;
};

export type AppNotifyInput = {
  variant?: AppNotificationVariant;
  title?: string;
  message: string;
  durationMs?: number;
};
