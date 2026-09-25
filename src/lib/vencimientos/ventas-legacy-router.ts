/**
 * Elige de qué base legacy salen las ventas de una sucursal:
 * la droguería factura en Quantio (plexdr) y las farmacias en Onze (onze_center).
 */

import { esSucursalDrogueriaPorId } from '@/lib/sucursales/drogueria';
import type { VentaDiariaProducto, VentasLegacyResult } from '@/lib/legacy-db/ventas-legacy-types';

export type FuenteVentasLegacy = 'onze' | 'quantio';

export function fuenteVentasParaSucursal(sucursalId: number): FuenteVentasLegacy {
  return esSucursalDrogueriaPorId(sucursalId) ? 'quantio' : 'onze';
}

export interface ConsultaVentasSucursal {
  /** Id de sucursal de la app (13 = droguería). */
  sucursalId: number;
  productoIds: number[];
  /** Fecha de emisión mínima (inclusive), YYYY-MM-DD. */
  desdeFecha: string;
}

export type ResultadoVentasSucursal = VentasLegacyResult & { fuente: FuenteVentasLegacy };

export async function getVentasDiariasSucursal(
  consulta: ConsultaVentasSucursal
): Promise<ResultadoVentasSucursal> {
  const fuente = fuenteVentasParaSucursal(consulta.sucursalId);

  if (fuente === 'quantio') {
    const { getVentasDiariasQuantio, getSucursalVentasQuantio } = await import(
      '@/lib/legacy-db/quantio-ventas'
    );
    const resultado = await getVentasDiariasQuantio({
      sucursalLegacyId: getSucursalVentasQuantio(),
      productoIds: consulta.productoIds,
      desdeFecha: consulta.desdeFecha,
    });
    return { ...resultado, fuente };
  }

  const { getVentasDiariasOnze } = await import('@/lib/legacy-db/mysql-ventas-onze');
  const resultado = await getVentasDiariasOnze({
    sucursalLegacyId: consulta.sucursalId,
    productoIds: consulta.productoIds,
    desdeFecha: consulta.desdeFecha,
  });
  return { ...resultado, fuente };
}

/** Agrupa las ventas por producto, ordenadas por fecha ascendente. */
export function agruparVentasPorProducto(
  ventas: VentaDiariaProducto[]
): Map<number, VentaDiariaProducto[]> {
  const map = new Map<number, VentaDiariaProducto[]>();
  for (const v of ventas) {
    const lista = map.get(v.productoId);
    if (lista) lista.push(v);
    else map.set(v.productoId, [v]);
  }
  for (const lista of map.values()) {
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  return map;
}
