'use client';

import { Fragment } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  colorVencimiento,
  diasHastaVencimiento,
  estiloFilaProgresoVenta,
  formatDate,
  formatDateTime,
} from '@/lib/utils';

export interface PorVencerItemMobile {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro?: string;
  cantidad: number;
  cantidad_vendida_acumulada?: number;
  vendido?: number;
  accion_observacion?: string | null;
  venta_posterior_a_carga?: boolean;
  categoria: string | null;
  descuento_aplicado?: number | null;
}

export type FilaAgrupadaMobile =
  | { tipo: 'uno'; item: PorVencerItemMobile }
  | { tipo: 'grupo'; key: string; items: PorVencerItemMobile[] };

interface PorVencerListMobileProps {
  filas: FilaAgrupadaMobile[];
  gruposExpandidos: Record<string, boolean>;
  onToggleGrupo: (key: string) => void;
  textoObs: (item: PorVencerItemMobile) => string;
  onObsChange: (id: string, value: string) => void;
  guardandoObsId: string | null;
  onGuardarObs: (item: PorVencerItemMobile) => void;
  onVendido: (id: string, cantidadDisponible: number) => void;
  onReducirCarga: (id: string, cantidadDisponible: number) => void;
  onArreglarVendido: (id: string, cantidadRestante: number, cantidadVendida: number) => void;
  ordenarItemsGrupo?: (items: PorVencerItemMobile[]) => PorVencerItemMobile[];
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

function ItemCard({
  item,
  nested,
  textoObs,
  onObsChange,
  guardandoObsId,
  onGuardarObs,
  onVendido,
  onReducirCarga,
  onArreglarVendido,
}: {
  item: PorVencerItemMobile;
  nested?: boolean;
  textoObs: (item: PorVencerItemMobile) => string;
  onObsChange: (id: string, value: string) => void;
  guardandoObsId: string | null;
  onGuardarObs: (item: PorVencerItemMobile) => void;
  onVendido: (id: string, cantidadDisponible: number) => void;
  onReducirCarga: (id: string, cantidadDisponible: number) => void;
  onArreglarVendido: (id: string, cantidadRestante: number, cantidadVendida: number) => void;
}) {
  const dias = diasHastaVencimiento(item.fecha_vencimiento);
  const color = colorVencimiento(dias);
  const vendHist = Number(item.cantidad_vendida_acumulada) || 0;
  const rest = Number(item.cantidad) || 0;
  const liquidado = rest <= 0;

  return (
    <article
      className={`border-l-4 px-2 py-2 ${nested ? 'bg-slate-50/90 dark:bg-slate-900/40' : 'bg-white dark:bg-slate-900'}`}
      style={estiloFilaProgresoVenta(rest, vendHist)}
    >
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex flex-wrap items-start gap-1.5">
            <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
              {item.descripcion}
            </h3>
            {liquidado ? (
              <span className="inline-flex shrink-0 rounded-full border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                Liquidado
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {item.presentacion} · {item.laboratorio}
          </p>
          <p className="mt-1 font-mono text-[11px] text-gray-500 dark:text-gray-500">
            {item.codigo_barras}
          </p>
          {nested ? (
            <p className="mt-1 text-[11px] text-gray-500">Control {item.control_id.slice(0, 8)}…</p>
          ) : null}
          {item.venta_posterior_a_carga ? (
            <p className="mt-1.5 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
              Venta posterior a la carga
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-700 dark:text-gray-300">{formatDate(item.fecha_vencimiento)}</span>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}
          >
            {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
          </span>
        </div>

        {item.categoria ? (
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-500">Categoría:</span> {item.categoria}
          </p>
        ) : null}

        {item.fecha_registro ? (
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-500">Carga:</span>{' '}
            {formatDateTime(item.fecha_registro)}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Restante" value={rest.toFixed(0)} emphasize />
          <StatPill label="Vendido" value={vendHist.toFixed(0)} emphasize />
          <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-1.5 dark:border-gray-700 dark:bg-slate-800/50">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Descuento
            </p>
            <div className="mt-1">
              <DescuentoBadge valor={item.descuento_aplicado} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
            Acción / observación
          </label>
          <textarea
            rows={2}
            value={textoObs(item)}
            onChange={(e) => onObsChange(item.id, e.target.value)}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900 dark:text-gray-100"
            placeholder="Acción tomada..."
          />
          <Button
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={guardandoObsId === item.id}
            onClick={() => onGuardarObs(item)}
          >
            {guardandoObsId === item.id ? 'Guardando…' : 'Guardar observación'}
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-10 flex-1"
              disabled={liquidado}
              onClick={() => onVendido(item.id, Number(item.cantidad ?? 0))}
            >
              Marcar vendido
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-10 px-3"
              title="Quitar por error de carga"
              disabled={liquidado}
              onClick={() => onReducirCarga(item.id, Number(item.cantidad ?? 0))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {vendHist > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-10 w-full"
              onClick={() =>
                onArreglarVendido(item.id, Number(item.cantidad ?? 0), vendHist)
              }
            >
              Arreglar cantidad vendida
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function PorVencerListMobile({
  filas,
  gruposExpandidos,
  onToggleGrupo,
  textoObs,
  onObsChange,
  guardandoObsId,
  onGuardarObs,
  onVendido,
  onReducirCarga,
  onArreglarVendido,
  ordenarItemsGrupo,
}: PorVencerListMobileProps) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {filas.map((fila) => {
        if (fila.tipo === 'uno') {
          return (
            <ItemCard
              key={fila.item.id}
              item={fila.item}
              textoObs={textoObs}
              onObsChange={onObsChange}
              guardandoObsId={guardandoObsId}
              onGuardarObs={onGuardarObs}
              onVendido={onVendido}
              onReducirCarga={onReducirCarga}
              onArreglarVendido={onArreglarVendido}
            />
          );
        }

        const grp = fila.items;
        const key = fila.key;
        const exp = gruposExpandidos[key] ?? false;
        const restG = grp.reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
        const vendG = grp.reduce((s, x) => s + (Number(x.cantidad_vendida_acumulada) || 0), 0);
        const liquidadoG = restG <= 0;
        const primero = grp[0]!;
        const dias = diasHastaVencimiento(primero.fecha_vencimiento);
        const color = colorVencimiento(dias);
        const desc0 = primero.descuento_aplicado;
        const descTodosIguales = grp.every((x) => x.descuento_aplicado === desc0);

        return (
          <Fragment key={key}>
            <article
              className="border-l-4 bg-white px-2 py-2 dark:bg-slate-900"
              style={estiloFilaProgresoVenta(restG, vendG)}
            >
              <div className="flex flex-col gap-2">
                <div>
                  <div className="flex flex-wrap items-start gap-1.5">
                    <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
                      {primero.descripcion}
                    </h3>
                    <span className="inline-flex shrink-0 rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100">
                      {grp.length} líneas
                    </span>
                    {liquidadoG ? (
                      <span className="inline-flex shrink-0 rounded-full border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                        Liquidado
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {primero.presentacion} · {primero.laboratorio}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">
                    {primero.codigo_barras}
                  </p>
                  {grp.some((x) => x.venta_posterior_a_carga) ? (
                    <p className="mt-1.5 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                      Venta posterior a la carga
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs">{formatDate(primero.fecha_vencimiento)}</span>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
                    {dias < 0 ? 'Vencido' : `En ${dias} día${dias !== 1 ? 's' : ''}`}
                  </span>
                </div>

                {primero.categoria ? (
                  <p className="text-xs text-gray-600">
                    <span className="font-medium text-gray-500">Categoría:</span> {primero.categoria}
                  </p>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  <StatPill label="Restante" value={restG.toFixed(0)} emphasize />
                  <StatPill label="Vendido" value={vendG.toFixed(0)} emphasize />
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-1.5 dark:border-gray-700 dark:bg-slate-800/50">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                      Descuento
                    </p>
                    <div className="mt-1">
                      {descTodosIguales ? (
                        <DescuentoBadge valor={desc0} />
                      ) : (
                        <span className="text-xs text-gray-500">Varía por línea</span>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full gap-1"
                  onClick={() => onToggleGrupo(key)}
                >
                  {exp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {exp ? 'Ocultar líneas' : `Ver ${grp.length} líneas`}
                </Button>
                <p className="text-[11px] text-gray-500">Observaciones y acciones por línea abajo.</p>
              </div>
            </article>
            {exp
              ? (ordenarItemsGrupo ? ordenarItemsGrupo(grp) : grp).map((r) => (
                  <ItemCard
                    key={r.id}
                    item={r}
                    nested
                    textoObs={textoObs}
                    onObsChange={onObsChange}
                    guardandoObsId={guardandoObsId}
                    onGuardarObs={onGuardarObs}
                    onVendido={onVendido}
                    onReducirCarga={onReducirCarga}
                    onArreglarVendido={onArreglarVendido}
                  />
                ))
              : null}
          </Fragment>
        );
      })}
    </div>
  );
}
