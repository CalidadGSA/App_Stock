'use client';

import { Button } from '@/components/ui/button';
import { ListStatPill } from '@/components/list/ListStatPill';

export interface AjusteDiferenciaMobile {
  id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
  origen?: string | null;
  diffCajas: number;
  diffUnidades: number;
}

export default function AjustesDiferenciasListMobile({
  items,
  clavesDuplicadas,
  onQuitar,
}: {
  items: AjusteDiferenciaMobile[];
  clavesDuplicadas: Set<string>;
  onQuitar: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((d) => {
        const claveDup = `${String(d.producto_id_sistema).trim()}::${String(d.codigo_barras ?? '').trim()}`;
        const esDuplicado = clavesDuplicadas.has(claveDup);
        return (
          <article
            key={d.id}
            className={`border-l-4 px-3 py-3 dark:bg-slate-900 ${
              esDuplicado
                ? 'border-amber-500 bg-amber-50/90 dark:bg-amber-950/30'
                : 'border-gray-300 bg-white'
            }`}
          >
            {esDuplicado ? (
              <p className="mb-1 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
                Duplicado en el periodo
              </p>
            ) : null}
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.descripcion}</h3>
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
              {[d.presentacion, d.laboratorio].filter(Boolean).join(' · ') || '—'}
            </p>
            <p className="mt-1 font-mono text-[11px] text-gray-600 dark:text-gray-400">{d.codigo_barras}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Origen: {d.origen === 'Auditoria' ? 'Auditoría' : 'Sucursal'}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ListStatPill
                label="Sistema"
                value={`${d.stock_sist_cajas ?? 0} / ${d.stock_sist_unidades ?? 0}`}
              />
              <ListStatPill
                label="Real"
                value={`${d.stock_real_cajas ?? 0} / ${d.stock_real_unidades ?? 0}`}
              />
            </div>
            <p className="mt-2 text-xs font-medium text-gray-800 dark:text-gray-200">
              Diferencia: {d.diffCajas.toFixed(0)} cajas / {d.diffUnidades.toFixed(0)} uds.
            </p>
            <Button
              className="mt-2 w-full sm:w-auto"
              variant="outline"
              size="sm"
              onClick={() => onQuitar(d.id)}
            >
              Quitar
            </Button>
          </article>
        );
      })}
    </div>
  );
}
