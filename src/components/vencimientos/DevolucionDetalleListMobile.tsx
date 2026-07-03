'use client';

import { ListStatPill } from '@/components/list/ListStatPill';
import { formatDate } from '@/lib/utils';

export interface DevolucionDetalleMobile {
  id: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  codigo_barras: string;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: string | null;
  accion_observacion: string | null;
}

export default function DevolucionDetalleListMobile({
  items,
}: {
  items: DevolucionDetalleMobile[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((d) => (
        <article
          key={d.id}
          className="border-l-4 border-violet-500/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.descripcion}</h3>
          {d.presentacion ? (
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{d.presentacion}</p>
          ) : null}
          <p className="mt-1 font-mono text-[11px] text-gray-600 dark:text-gray-400">{d.codigo_barras}</p>
          {d.laboratorio ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Laboratorio:</span> {d.laboratorio}
            </p>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ListStatPill label="Vencimiento" value={formatDate(d.fecha_vencimiento)} />
            <ListStatPill
              label="Cantidad"
              value={Number(d.cantidad).toFixed(2)}
              emphasize
            />
          </div>
          {d.categoria_macro ? (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Categoría:</span> {d.categoria_macro}
            </p>
          ) : null}
          {d.accion_observacion?.trim() ? (
            <div className="mt-2 rounded-md border border-gray-200 bg-gray-50/80 px-2.5 py-2 dark:border-gray-700 dark:bg-slate-800/50">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Acción / observación
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-800 dark:text-gray-200">
                {d.accion_observacion.trim()}
              </p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
