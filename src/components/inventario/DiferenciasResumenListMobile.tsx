'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { ListStatPill } from '@/components/list/ListStatPill';
import { formatDateTime } from '@/lib/utils';
import { etiquetaTipoControlInventario, inferirTipoControlInventario } from '@/lib/inventario/tipo-control';

export interface DiferenciaResumenMobile {
  detalle_id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  operador: string;
  fecha_control: string;
  control_tipo: string | null;
  control_descripcion: string | null;
  diffCajas: number;
  diffUnidades: number;
}

function etiquetaControl(r: DiferenciaResumenMobile): string {
  if (r.control_descripcion?.trim()) return r.control_descripcion.trim();
  if (r.control_tipo) {
    return etiquetaTipoControlInventario(
      inferirTipoControlInventario({ tipo: r.control_tipo })
    );
  }
  return `Control ${r.control_id.slice(0, 8)}…`;
}

export default function DiferenciasResumenListMobile({
  items,
}: {
  items: DiferenciaResumenMobile[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((r) => (
        <article
          key={`${r.detalle_id}-${r.control_id}`}
          className="border-l-4 border-blue-400/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{r.descripcion}</h3>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {r.presentacion} · {r.laboratorio}
          </p>
          <p className="mt-1 text-[11px] text-gray-500">ID {r.producto_id_sistema}</p>
          <p className="mt-1 font-mono text-[11px] text-gray-600 dark:text-gray-400">{r.codigo_barras}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ListStatPill
              label="Dif. cajas"
              value={`${r.diffCajas > 0 ? '+' : ''}${r.diffCajas.toFixed(0)}`}
              emphasize
            />
            <ListStatPill
              label="Dif. unid."
              value={`${r.diffUnidades > 0 ? '+' : ''}${r.diffUnidades.toFixed(0)}`}
              emphasize
            />
          </div>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-500">Control:</span> {etiquetaControl(r)}
          </p>
          {r.fecha_control ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Fecha:</span>{' '}
              {formatDateTime(r.fecha_control)}
            </p>
          ) : null}
          {r.operador ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Operador:</span> {r.operador}
            </p>
          ) : null}
          <Link
            href={`/inventario/${r.control_id}`}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver control
          </Link>
        </article>
      ))}
    </div>
  );
}
