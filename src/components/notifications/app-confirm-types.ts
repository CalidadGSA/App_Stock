export type AppConfirmVariant = 'default' | 'warning' | 'danger';

export type AppConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: AppConfirmVariant;
};

export type PendingAppConfirm = AppConfirmOptions & {
  id: string;
  resolve: (value: boolean) => void;
};
