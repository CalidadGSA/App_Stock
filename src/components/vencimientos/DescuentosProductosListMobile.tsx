'use client';

import { ListStatPill } from '@/components/list/ListStatPill';

export interface DescuentoProductoMobile {
  codigo_barras: string;
  categoria_final: string;
  descuento: number;
  cantidad: number;
  dias_hasta: number;
}

export default function DescuentosProductosListMobile({
  items,
}: {
  items: DescuentoProductoMobile[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((i, idx) => (
        <article
          key={`${i.codigo_barras}-${idx}`}
          className="border-l-4 border-emerald-400/80 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{i.codigo_barras}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{i.categoria_final}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <ListStatPill
              label="Descuento"
              value={`${Math.round(i.descuento)}%`}
              emphasize
              valueClassName="text-red-700 dark:text-red-400"
            />
            <ListStatPill label="Cantidad" value={Math.round(i.cantidad).toString()} emphasize />
            <ListStatPill label="Días" value={String(i.dias_hasta)} emphasize />
          </div>
        </article>
      ))}
    </div>
  );
}
