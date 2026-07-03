'use client';

import { Badge } from '@/components/ui/badge';
import { ListStatPill } from '@/components/list/ListStatPill';
import { formatDateTime } from '@/lib/utils';
import type { DiferenciaPsicoOcasionalItem } from '@/app/api/admin/diferencias-psico-ocasional/route';

function badgeVariant(tipo: DiferenciaPsicoOcasionalItem['tipo_controlado']) {
  return tipo === 'estupefaciente' ? 'danger' : 'warning';
}

export default function DiferenciasPsicoListMobile({
  items,
}: {
  items: DiferenciaPsicoOcasionalItem[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((item) => (
        <article
          key={item.id}
          className="border-l-4 border-indigo-400/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariant(item.tipo_controlado)}>{item.tipo_controlado_label}</Badge>
              {item.ajustado ? (
                <Badge variant="outline">Ajustado</Badge>
              ) : (
                <Badge variant="warning">Pendiente</Badge>
              )}
            </div>
            {item.psicofarmaco_nombre ? (
              <p className="text-[11px] text-gray-500">{item.psicofarmaco_nombre}</p>
            ) : null}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.descripcion}</h3>
              {item.presentacion ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">{item.presentacion}</p>
              ) : null}
              {item.laboratorio ? (
                <p className="text-xs text-gray-500">{item.laboratorio}</p>
              ) : null}
              <p className="mt-1 font-mono text-[11px] text-gray-500">{item.codigo_barras || '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ListStatPill
                label="Dif. cajas"
                value={`${item.diff_cajas > 0 ? '+' : ''}${item.diff_cajas}`}
                emphasize
                valueClassName={
                  item.diff_cajas !== 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400'
                }
              />
              <ListStatPill
                label="Dif. unid."
                value={`${item.diff_unidades > 0 ? '+' : ''}${item.diff_unidades}`}
                emphasize
                valueClassName={
                  item.diff_unidades !== 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400'
                }
              />
            </div>
            <p className="text-xs text-gray-500">
              <span className="font-medium text-gray-600 dark:text-gray-400">Control:</span>{' '}
              {formatDateTime(item.fecha_control)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
