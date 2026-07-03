'use client';

import { formatDate, formatDateTime } from '@/lib/utils';

export type FilaImpresionVencimientoCompacta = {
  id: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro?: string | null;
  cantidad: number;
  cantidad_vendida_acumulada?: number;
};

/** Una fila por línea de vencimiento (para devolver / por vencer). Solo visible al imprimir. */
export function TablaImpresionVencimientosCompacta({
  items,
}: {
  items: FilaImpresionVencimientoCompacta[];
}) {
  return (
    <table
      data-vencimientos-print-compact
      className="datatable-print-only w-full border-collapse"
    >
      <thead>
        <tr className="border-b border-gray-400">
          <th className="px-1 py-0.5 text-left font-semibold">Cód. barras</th>
          <th className="px-1 py-0.5 text-left font-semibold">Producto</th>
          <th className="px-1 py-0.5 text-left font-semibold">Presentación</th>
          <th className="px-1 py-0.5 text-left font-semibold">Laboratorio</th>
          <th className="px-1 py-0.5 text-left font-semibold whitespace-nowrap">Venc.</th>
          <th className="px-1 py-0.5 text-left font-semibold whitespace-nowrap">Carga</th>
          <th className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">Rest.</th>
          <th className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">Vend.</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id} className="border-b border-gray-200">
            <td className="px-1 py-0.5 align-middle font-mono whitespace-nowrap">{r.codigo_barras}</td>
            <td className="px-1 py-0.5 align-middle">{r.descripcion}</td>
            <td className="px-1 py-0.5 align-middle">{r.presentacion ?? '—'}</td>
            <td className="px-1 py-0.5 align-middle">{r.laboratorio ?? '—'}</td>
            <td className="px-1 py-0.5 align-middle whitespace-nowrap">{formatDate(r.fecha_vencimiento)}</td>
            <td className="px-1 py-0.5 align-middle whitespace-nowrap">
              {r.fecha_registro ? formatDateTime(r.fecha_registro) : '—'}
            </td>
            <td className="px-1 py-0.5 align-middle text-right tabular-nums whitespace-nowrap">
              {Number(r.cantidad ?? 0).toFixed(0)}
            </td>
            <td className="px-1 py-0.5 align-middle text-right tabular-nums whitespace-nowrap">
              {Number(r.cantidad_vendida_acumulada ?? 0).toFixed(0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
