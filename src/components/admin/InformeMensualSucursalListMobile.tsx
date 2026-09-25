'use client';

import { ListStatPill } from '@/components/list/ListStatPill';
import type { InformeMensualDetalleSucursal } from '@/app/api/admin/informe-mensual/route';
import { formatPorcentaje, porcentajeDesdeRatio } from '@/lib/utils';

function textoConPorcentaje(numerador: number, denominador: number): string {
  if (denominador <= 0) return String(numerador);
  const pct = formatPorcentaje(porcentajeDesdeRatio(numerador, denominador));
  return `${numerador} (${pct}%)`;
}

function textoConDiferenciaInventariados(conDif: number, inventariados: number): string {
  return textoConPorcentaje(conDif, inventariados);
}

function fmtMoneda(n: number) {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export default function InformeMensualSucursalListMobile({
  rows,
}: {
  rows: InformeMensualDetalleSucursal[];
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {rows.map((row) => (
        <article
          key={row.sucursal_id}
          className="border-l-4 border-blue-400/70 bg-white px-3 py-3 dark:bg-slate-900"
        >
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {row.nombrefantasia}
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ListStatPill
              label="Invent. mes"
              value={textoConPorcentaje(
                row.productos_inventariados,
                row.total_base_trimestre
              )}
            />
            <ListStatPill
              label="Con diferencia"
              value={textoConDiferenciaInventariados(
                row.productos_con_diferencia,
                row.productos_inventariados
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
              value={textoConPorcentaje(
                row.productos_mal_contados,
                row.productos_con_diferencia
              )}
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
              label="P. vencer mes"
              value={String(row.por_vencer_mes)}
              emphasize
              valueClassName={
                row.por_vencer_mes > 0 ? 'text-amber-700 dark:text-amber-400' : undefined
              }
            />
            <ListStatPill
              label="Vencidos mes"
              value={String(row.productos_vencidos_mes)}
              valueClassName={
                row.productos_vencidos_mes > 0
                  ? 'text-red-700 dark:text-red-400'
                  : undefined
              }
            />
            <ListStatPill
              label="Costo vencidos"
              value={fmtMoneda(row.vencidos_costo)}
              emphasize
              valueClassName={
                row.vencidos_costo > 0 ? 'text-red-700 dark:text-red-400' : undefined
              }
            />
            <ListStatPill
              label="Vendidos"
              value={Number(row.unidades_vencidos_vendidas).toLocaleString('es-AR', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
              valueClassName={
                Number(row.unidades_vencidos_vendidas) > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : undefined
              }
            />
          </div>
        </article>
      ))}
    </div>
  );
}
