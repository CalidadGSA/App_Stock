'use client';

import { ListStatPill } from '@/components/list/ListStatPill';
import { formatDateTime } from '@/lib/utils';
import { etiquetaTipoControlInventario } from '@/lib/inventario/tipo-control';
import type { TipoControlInventario } from '@/lib/inventario/tipo-control';

export interface DiferenciaConsolidadoMobile {
  detalle_id: string;
  control_id: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  codigo_barras: string;
  diffCajas: number;
  diffUnidades: number;
  operador: string;
  fecha_control: string;
  control_tipo: string | null;
  control_origen: string | null;
  cat_macro: string | null;
  sucursal_nombre?: string | null;
}

function etiquetaOrigen(o: string | null | undefined): string {
  const t = String(o ?? '').trim();
  if (t === 'Auditoria') return 'Auditoría';
  if (t === 'Sucursal') return 'Sucursal';
  return t || '—';
}

export default function DiferenciasConsolidadoListMobile({
  items,
}: {
  items: DiferenciaConsolidadoMobile[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((r) => (
        <article
          key={`${r.detalle_id}-${r.control_id}`}
          className="border-l-4 border-amber-500/80 bg-white px-2 py-2 dark:bg-slate-900"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            {r.sucursal_nombre?.trim() || 'Sin sucursal'}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{r.descripcion}</h3>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {[r.presentacion, r.laboratorio].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="mt-1 font-mono text-[11px] text-gray-600 dark:text-gray-400">{r.codigo_barras}</p>
          {r.cat_macro ? (
            <p className="mt-1 text-[10px] text-gray-500">{r.cat_macro}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-300">
              {etiquetaOrigen(r.control_origen)}
            </span>
            {r.control_tipo ? (
              <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-300">
                {etiquetaTipoControlInventario(r.control_tipo as TipoControlInventario)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ListStatPill
              label="Dif. cajas"
              value={`${r.diffCajas > 0 ? '+' : ''}${r.diffCajas}`}
              emphasize
            />
            <ListStatPill
              label="Dif. unid."
              value={`${r.diffUnidades > 0 ? '+' : ''}${r.diffUnidades}`}
              emphasize
            />
          </div>
          {r.fecha_control ? (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Fecha control:</span>{' '}
              {formatDateTime(r.fecha_control)}
            </p>
          ) : null}
          {r.operador ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Operador:</span> {r.operador}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
