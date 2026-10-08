/**
 * Detecta si un producto cargado en un control de vencimientos se vendió **después** de haberlo
 * cargado, consultando la facturación real (Onze para farmacias, Quantio para la droguería).
 *
 * Es solo informativo: no descuenta cantidades ni marca nada como vendido. Sirve para que el
 * encargado vea de un vistazo qué líneas probablemente ya no estén en la góndola, antes de salir
 * a buscarlas.
 *
 * La facturación tiene granularidad diaria, así que se cuentan las ventas de días **posteriores**
 * al de la carga. Las del mismo día quedan afuera a propósito: no se puede saber si fueron antes
 * o después de cargar la línea, y marcarlas daría falsos positivos.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fechaDiaDeIso } from '@/lib/vencimientos/ventas-auto-asignacion';
import {
  agruparVentasPorProducto,
  getVentasDiariasSucursal,
} from '@/lib/vencimientos/ventas-legacy-router';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/** No tiene sentido barrer años de facturación para una línea vieja. */
const VENTANA_MAX_DIAS = 400;
/** Los uuid viajan en la URL de PostgREST: más de ~300 y la request falla. */
const IDS_POR_CONSULTA = 100;

export interface VentaPosteriorDetalle {
  /** Unidades facturadas en días posteriores al de la carga. */
  unidades: number;
  /** Fecha de la última venta registrada (YYYY-MM-DD). */
  ultima_fecha: string;
  /** Días con venta posteriores a la carga. */
  dias: number;
}

export type VentasPosterioresResultado =
  | { ok: true; porDetalle: Record<string, VentaPosteriorDetalle>; consultados: number }
  | { ok: false; error: string };

function hoyMenosDias(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export async function detectarVentasPosteriores(
  admin: AdminClient,
  sucursalId: number,
  detalleIds: string[]
): Promise<VentasPosterioresResultado> {
  const ids = Array.from(new Set(detalleIds.map((x) => String(x).trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: true, porDetalle: {}, consultados: 0 };

  type Fila = {
    id: string;
    producto_id_sistema: string | null;
    fecha_registro: string | null;
  };

  const crudas: Fila[] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
    const lote = ids.slice(i, i + IDS_POR_CONSULTA);
    const { data, error } = await admin
      .from('controles_vencimientos_detalle')
      .select('id, producto_id_sistema, fecha_registro, controles_vencimientos!inner(sucursal_id)')
      .in('id', lote)
      .eq('controles_vencimientos.sucursal_id', sucursalId);

    if (error) return { ok: false, error: error.message };
    crudas.push(...((data ?? []) as unknown as Fila[]));
  }

  const filas = crudas
    .map((f) => ({
      id: String(f.id),
      productoId: Number(f.producto_id_sistema),
      diaCarga: fechaDiaDeIso(String(f.fecha_registro ?? '')),
    }))
    .filter((f) => Number.isFinite(f.productoId) && f.productoId > 0 && f.diaCarga);

  if (filas.length === 0) return { ok: true, porDetalle: {}, consultados: 0 };

  // Se pide desde la carga más vieja del lote, con un tope para no barrer años.
  const minDia = filas.reduce((min, f) => (f.diaCarga < min ? f.diaCarga : min), filas[0].diaCarga);
  const tope = hoyMenosDias(VENTANA_MAX_DIAS);
  const desdeFecha = minDia < tope ? tope : minDia;

  const ventas = await getVentasDiariasSucursal({
    sucursalId,
    productoIds: Array.from(new Set(filas.map((f) => f.productoId))),
    desdeFecha,
  });

  if (!ventas.ok) return { ok: false, error: ventas.error };

  const porProducto = agruparVentasPorProducto(ventas.ventas);
  const porDetalle: Record<string, VentaPosteriorDetalle> = {};

  for (const fila of filas) {
    const delProducto = porProducto.get(fila.productoId) ?? [];
    let unidades = 0;
    let dias = 0;
    let ultima = '';

    for (const v of delProducto) {
      // Estrictamente posterior: las del mismo día no se pueden atribuir.
      if (v.fecha <= fila.diaCarga) continue;
      if (v.cantidad <= 0) continue;
      unidades += v.cantidad;
      dias += 1;
      if (v.fecha > ultima) ultima = v.fecha;
    }

    if (unidades > 0) {
      porDetalle[fila.id] = { unidades, ultima_fecha: ultima, dias };
    }
  }

  return { ok: true, porDetalle, consultados: filas.length };
}
