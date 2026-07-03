'use client';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';

export interface AjusteHistorialMobile {
  id: string;
  fecha_creado: string;
  archivo_nombre: string;
  origen?: string | null;
}

function etiquetaOrigen(origen: string | null | undefined): string {
  if (origen === 'Auditoria') return 'Auditoría';
  if (origen === 'Sucursal') return 'Sucursal';
  if (origen === 'Ambos') return 'Ambos';
  return 'Desconocido';
}

export default function AjustesHistorialListMobile({
  items,
  onReexportar,
}: {
  items: AjusteHistorialMobile[];
  onReexportar: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((a) => (
        <article
          key={a.id}
          className="border-l-4 border-slate-400/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {formatDateTime(a.fecha_creado)}
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {a.archivo_nombre}
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Origen: {etiquetaOrigen(a.origen)}
          </p>
          <Button
            className="mt-2 w-full sm:w-auto"
            size="sm"
            variant="outline"
            onClick={() => onReexportar(a.id)}
          >
            Descargar CSV
          </Button>
        </article>
      ))}
    </div>
  );
}
