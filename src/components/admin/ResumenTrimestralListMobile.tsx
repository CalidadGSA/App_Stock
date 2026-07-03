'use client';

import { ListStatPill } from '@/components/list/ListStatPill';
import type { ResumenTrimestralSucursalRow } from '@/app/api/admin/resumen-trimestral/route';
import { formatPorcentaje, porcentajeDesdeRatio } from '@/lib/utils';

function textoConDiferenciaInventariados(conDif: number, inventariados: number): string {
  if (inventariados <= 0) return String(conDif);
  const pct = formatPorcentaje(porcentajeDesdeRatio(conDif, inventariados));
  return `${conDif} (${pct}%)`;
}

export default function ResumenTrimestralListMobile({
  rows,
  trimestreActual,
}: {
  rows: ResumenTrimestralSucursalRow[];
  trimestreActual?: string;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {rows.map((row) => (
        <article
          key={row.sucursal_id}
          className="border-l-4 border-blue-400/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {row.sucursal_nombre}
              </h3>
              {row.trimestre && row.trimestre !== trimestreActual ? (
                <p className="text-xs text-gray-500">{row.trimestre}</p>
              ) : null}
            </div>
            {row.total > 0 ? (
              <>
                <div className="h-2 w-full rounded bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-2 rounded bg-blue-600"
                    style={{ width: `${Math.max(0, Math.min(100, row.porcentaje))}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {row.inventariados} de {row.total} inventariados · {row.pendientes} pendientes
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <ListStatPill label="Progreso" value={`${row.porcentaje}%`} emphasize />
                  <ListStatPill
                    label="Con diferencia"
                    value={textoConDiferenciaInventariados(
                      row.productos_con_diferencia,
                      row.inventariados
                    )}
                    emphasize
                    valueClassName={
                      row.productos_con_diferencia > 0
                        ? 'text-violet-700 dark:text-violet-400'
                        : undefined
                    }
                  />
                  <ListStatPill
                    label="Mal contados"
                    value={String(row.productos_mal_contados)}
                    emphasize
                    valueClassName={
                      row.productos_mal_contados > 0
                        ? 'text-violet-700 dark:text-violet-400'
                        : undefined
                    }
                  />
                  <ListStatPill
                    label="Venc. cargados"
                    value={String(row.productos_cargados_vencimientos)}
                  />
                  <ListStatPill
                    label="Por vencer trim."
                    value={String(row.por_vencer_trimestre)}
                    emphasize
                    valueClassName={
                      row.por_vencer_trimestre > 0
                        ? 'text-amber-700 dark:text-amber-400'
                        : undefined
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ListStatPill label="≤30 d" value={String(row.por_vencer_30_dias)} />
                  <ListStatPill label="31–60 d" value={String(row.por_vencer_31_60_dias)} />
                  <ListStatPill label="61–90 d" value={String(row.por_vencer_61_90_dias)} />
                  <ListStatPill
                    label="Vencidos"
                    value={String(row.productos_vencidos_trimestre)}
                    emphasize
                    valueClassName={
                      row.productos_vencidos_trimestre > 0
                        ? 'text-red-700 dark:text-red-400'
                        : undefined
                    }
                  />
                  <ListStatPill
                    label="Vendidos"
                    value={String(row.unidades_vencidos_vendidas)}
                    emphasize
                    valueClassName={
                      row.unidades_vencidos_vendidas > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400">Sin base asignada</p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
