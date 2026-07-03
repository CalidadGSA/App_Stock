'use client';

import { formatDateTime } from '@/lib/utils';
import { etiquetaTipoControlInventario } from '@/lib/inventario/tipo-control';
import type { TipoControlInventario } from '@/lib/inventario/tipo-control';

export type FilaImpresionDiferenciaCompacta = {
  detalle_id: string;
  control_id: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  sucursal_nombre?: string | null;
  control_origen: string | null;
  control_tipo: string | null;
  diffCajas: number;
  diffUnidades: number;
  fecha_control: string;
  operador: string;
};

function etiquetaOrigen(o: string | null | undefined): string {
  const t = String(o ?? '').trim();
  if (t === 'Auditoria') return 'Auditoría';
  if (t === 'Sucursal') return 'Sucursal';
  return t || '—';
}

/** Una fila por diferencia. Solo visible al imprimir. */
export function TablaImpresionDiferenciasConsolidado({
  items,
}: {
  items: FilaImpresionDiferenciaCompacta[];
}) {
  return (
    <table
      data-vencimientos-print-compact-dif
      className="datatable-print-only w-full border-collapse"
    >
      <thead>
        <tr className="border-b border-gray-400">
          <th className="px-1 py-0.5 text-left font-semibold">Cód. barras</th>
          <th className="px-1 py-0.5 text-left font-semibold">Producto</th>
          <th className="px-1 py-0.5 text-left font-semibold">Present.</th>
          <th className="px-1 py-0.5 text-left font-semibold">Laboratorio</th>
          <th className="px-1 py-0.5 text-left font-semibold">Sucursal</th>
          <th className="px-1 py-0.5 text-left font-semibold whitespace-nowrap">Origen</th>
          <th className="px-1 py-0.5 text-left font-semibold whitespace-nowrap">Tipo</th>
          <th className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">Dif.C</th>
          <th className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">Dif.U</th>
          <th className="px-1 py-0.5 text-left font-semibold whitespace-nowrap">Fecha</th>
          <th className="px-1 py-0.5 text-left font-semibold">Operador</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={`${r.detalle_id}-${r.control_id}`} className="border-b border-gray-200">
            <td className="px-1 py-0.5 align-middle font-mono whitespace-nowrap">{r.codigo_barras}</td>
            <td className="px-1 py-0.5 align-middle">{r.descripcion}</td>
            <td className="px-1 py-0.5 align-middle">{r.presentacion ?? '—'}</td>
            <td className="px-1 py-0.5 align-middle">{r.laboratorio ?? '—'}</td>
            <td className="px-1 py-0.5 align-middle">{r.sucursal_nombre ?? '—'}</td>
            <td className="px-1 py-0.5 align-middle whitespace-nowrap">
              {etiquetaOrigen(r.control_origen)}
            </td>
            <td className="px-1 py-0.5 align-middle whitespace-nowrap">
              {r.control_tipo
                ? etiquetaTipoControlInventario(r.control_tipo as TipoControlInventario)
                : '—'}
            </td>
            <td className="px-1 py-0.5 align-middle text-right tabular-nums whitespace-nowrap">
              {r.diffCajas > 0 ? '+' : ''}
              {r.diffCajas}
            </td>
            <td className="px-1 py-0.5 align-middle text-right tabular-nums whitespace-nowrap">
              {r.diffUnidades > 0 ? '+' : ''}
              {r.diffUnidades}
            </td>
            <td className="px-1 py-0.5 align-middle whitespace-nowrap">
              {r.fecha_control ? formatDateTime(r.fecha_control) : '—'}
            </td>
            <td className="px-1 py-0.5 align-middle">{r.operador}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
