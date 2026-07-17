'use client';

import { Button } from '@/components/ui/button';
import {
  formatDate,
  diasHastaVencimiento,
  colorVencimiento,
  etiquetaDiasHastaVencimiento,
} from '@/lib/utils';
import { textoBadgeDrogueriaDevolucion, TRAZABLE_LABEL } from '@/lib/vencimientos-drogueria-lab';

export interface VencidoItemMobile {
  id: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: string | null;
  cantidad_vendida_acumulada: number;
  cantidad_cargada_original: number;
  venta_posterior_a_carga?: boolean;
  drogueria_devolucion?: string | null;
  trazable?: boolean;
}

interface VencidosListMobileProps {
  items: VencidoItemMobile[];
  textoObs: (item: VencidoItemMobile) => string;
  onObsChange: (id: string, value: string) => void;
  guardandoId: string | null;
  onGuardarObs: (item: VencidoItemMobile) => void;
  onVendido: (id: string, cantidadDisponible: number) => void;
  alertaObs: (item: VencidoItemMobile) => boolean;
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
    <div className="rounded-md border border-gray-200 bg-gray-50/80 px-1.5 py-1 dark:border-gray-700 dark:bg-slate-800/50">
      <p className="text-[9px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-0 text-xs tabular-nums sm:text-sm ${emphasize ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function VencidosListMobile({
  items,
  textoObs,
  onObsChange,
  guardandoId,
  onGuardarObs,
  onVendido,
  alertaObs,
}: VencidosListMobileProps) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((r) => {
        const dias = diasHastaVencimiento(r.fecha_vencimiento);
        const color = colorVencimiento(dias);
        const rest = Number(r.cantidad ?? 0);
        const vend = r.cantidad_vendida_acumulada;
        const orig = r.cantidad_cargada_original;
        const alerta = alertaObs(r);

        return (
          <article
            key={r.id}
            className="border-l-4 border-red-400/80 bg-white px-2 py-2 dark:bg-slate-900"
          >
            <div className="flex flex-col gap-2">
              <div>
                <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
                  {r.descripcion}
                </h3>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {r.presentacion} · {r.laboratorio}
                </p>
                <p className="mt-1 font-mono text-[11px] text-gray-500">{r.codigo_barras}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.categoria_macro ? (
                    <span className="inline-flex rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-300">
                      {r.categoria_macro}
                    </span>
                  ) : null}
                  {alerta ? (
                    <span
                      data-print-hide
                      className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      Observación requerida
                    </span>
                  ) : null}
                  {r.venta_posterior_a_carga ? (
                    <span
                      data-print-hide
                      className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      Venta posterior a la carga
                    </span>
                  ) : null}
                  {r.trazable ? (
                    <span
                      data-print-hide
                      className="inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
                    >
                      {TRAZABLE_LABEL}
                    </span>
                  ) : null}
                  {textoBadgeDrogueriaDevolucion(r.drogueria_devolucion) ? (
                    <span
                      data-print-hide
                      className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                    >
                      {textoBadgeDrogueriaDevolucion(r.drogueria_devolucion)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {formatDate(r.fecha_vencimiento)}
                </span>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                  {etiquetaDiasHastaVencimiento(dias)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <StatPill label="Carga" value={orig.toFixed(0)} emphasize />
                <StatPill label="Restante" value={rest.toFixed(0)} emphasize />
                <StatPill label="Vendido" value={vend.toFixed(0)} emphasize />
              </div>

              <div className="space-y-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                  Acción / observación
                </label>
                <textarea
                  rows={2}
                  value={textoObs(r)}
                  onChange={(e) => onObsChange(r.id, e.target.value)}
                  className="w-full resize-y rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
                  placeholder="Acción tomada..."
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={guardandoId === r.id}
                  onClick={() => onGuardarObs(r)}
                >
                  {guardandoId === r.id ? 'Guardando…' : 'Guardar observación'}
                </Button>
              </div>

              <div className="border-t border-gray-100 pt-2 dark:border-gray-800">
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-10 w-full"
                  disabled={rest <= 0}
                  onClick={() => onVendido(r.id, rest)}
                >
                  Marcar vendido
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
