'use client';

import {
  formatDate,
  formatDateTime,
  diasHastaVencimiento,
  colorVencimiento,
  estiloFilaProgresoVenta,
} from '@/lib/utils';

export interface ConsolidadoItemMobile {
  id: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  codigo_barras: string;
  sucursal_nombre?: string | null;
  sucursal_id: number;
  cat_macro: string | null;
  categoria: string | null;
  fecha_registro?: string;
  fecha_vencimiento: string;
  cantidad: number;
  cantidad_vendida_acumulada?: number;
  descuento_aplicado?: number | null;
}

function StatPill({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-1.5 dark:border-gray-700 dark:bg-slate-800/50">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-0.5 text-sm tabular-nums ${emphasize ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}
      >
        {value}
      </p>
    </div>
  );
}

function DescuentoBadge({ valor }: { valor: number | null | undefined }) {
  if (typeof valor !== 'number') {
    return <span className="text-gray-400 dark:text-gray-500">—</span>;
  }
  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
      -{Math.abs(valor)}%
    </span>
  );
}

export default function ConsolidadoListMobile({ items }: { items: ConsolidadoItemMobile[] }) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((r) => {
        const dias = diasHastaVencimiento(r.fecha_vencimiento);
        const color = colorVencimiento(dias);
        const vendHist = Number(r.cantidad_vendida_acumulada) || 0;
        const rest = Number(r.cantidad) || 0;
        const liquidado = rest <= 0;

        return (
          <article
            key={r.id}
            className="border-l-4 bg-white px-3 py-3 dark:bg-slate-900"
            style={estiloFilaProgresoVenta(rest, vendHist)}
          >
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                  {r.sucursal_nombre || `Sucursal ${r.sucursal_id}`}
                </p>
                <div className="mt-1 flex flex-wrap items-start gap-1.5">
                  <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
                    {r.descripcion}
                  </h3>
                  {liquidado ? (
                    <span className="inline-flex shrink-0 rounded-full border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                      Liquidado
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {r.presentacion} · {r.laboratorio}
                </p>
                <p className="mt-1 font-mono text-[11px] text-gray-500">{r.codigo_barras}</p>
              </div>

              {(r.cat_macro || r.categoria) && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {r.cat_macro ? (
                    <>
                      <span className="font-medium text-gray-500">Padrón:</span> {r.cat_macro}
                    </>
                  ) : null}
                  {r.cat_macro && r.categoria ? ' · ' : null}
                  {r.categoria ? (
                    <>
                      <span className="font-medium text-gray-500">Cat.:</span> {r.categoria}
                    </>
                  ) : null}
                </p>
              )}

              {r.fecha_registro ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-500">Carga:</span>{' '}
                  {formatDateTime(r.fecha_registro)}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {formatDate(r.fecha_vencimiento)}
                </span>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}
                >
                  {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <StatPill label="Restante" value={rest.toFixed(0)} emphasize />
                <StatPill label="Vendido" value={vendHist.toFixed(0)} emphasize />
                <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-1.5 dark:border-gray-700 dark:bg-slate-800/50">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Descuento
                  </p>
                  <div className="mt-1">
                    <DescuentoBadge valor={r.descuento_aplicado} />
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
