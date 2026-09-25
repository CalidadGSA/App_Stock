export type AppConfirmVariant = 'default' | 'warning' | 'danger';

export type AppConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: AppConfirmVariant;
};

/** Resultado de un confirm con hasta 3 acciones. */
export type AppConfirmChoice = 'cancel' | 'confirm' | 'alt';

export type AppConfirmChoiceOptions = AppConfirmOptions & {
  /** Segunda acción afirmativa (ej. «Cerrar y marcar no controlados»). */
  altConfirmLabel: string;
};

export type PendingAppConfirm =
  | (AppConfirmOptions & {
      id: string;
      mode: 'boolean';
      resolve: (value: boolean) => void;
    })
  | (AppConfirmChoiceOptions & {
      id: string;
      mode: 'choice';
      resolve: (value: AppConfirmChoice) => void;
    });
