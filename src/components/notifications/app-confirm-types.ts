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

/** Pedido de un número con el diálogo de la app, en vez de `window.prompt`. */
export type AppPromptNumeroOptions = {
  title?: string;
  message: string;
  /** Texto chico debajo del campo (p. ej. el detalle de la línea). */
  detalle?: string;
  label?: string;
  valorInicial?: number;
  min?: number;
  max?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: AppConfirmVariant;
};

export type PendingAppPromptNumero = AppPromptNumeroOptions & {
  id: string;
  /** `null` = canceló. */
  resolve: (value: number | null) => void;
};
