/**
 * Reparto de ventas reales sobre las líneas cargadas en controles de vencimientos.
 *
 * Las ventas legacy no distinguen lote ni vencimiento (solo producto, sucursal y fecha),
 * así que se asignan FIFO: primero el vencimiento más próximo y, a igual vencimiento,
 * la carga más antigua. Una línea recién cargada no absorbe ventas anteriores a su carga.
 */

import type { VentaDiariaProducto } from '@/lib/legacy-db/ventas-legacy-types';

export interface LineaParaAsignar {
  id: string;
  /** YYYY-MM-DD */
  fechaVencimiento: string;
  /** Timestamp ISO de la carga en el control. */
  fechaRegistro: string;
  /** Cantidad cargada originalmente (tope de lo que puede darse por vendido). */
  cantidadOriginal: number;
}

/** Vendido total objetivo por línea (incluye lo que ya se hubiera registrado a mano). */
export type AsignacionVentas = Map<string, number>;

export function fechaDiaDeIso(iso: string): string {
  const s = String(iso ?? '').trim();
  if (!s) return '';
  // Los timestamps de Supabase vienen como 2026-08-31T12:34:56.000Z
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ordena por vencimiento más próximo y, a igual vencimiento, por carga más antigua.
 * El id desempata para que el reparto sea estable entre corridas.
 */
export function ordenarLineasFifo(lineas: LineaParaAsignar[]): LineaParaAsignar[] {
  return [...lineas].sort((a, b) => {
    const porVencimiento = a.fechaVencimiento.localeCompare(b.fechaVencimiento);
    if (porVencimiento !== 0) return porVencimiento;
    const porCarga = String(a.fechaRegistro).localeCompare(String(b.fechaRegistro));
    if (porCarga !== 0) return porCarga;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Reparte las ventas diarias de un producto entre sus líneas.
 * Las ventas que ninguna línea puede absorber (anteriores a toda carga, o que superan lo
 * cargado) se descartan: son stock que no estaba en el control.
 */
export function asignarVentasAlProducto(
  lineas: LineaParaAsignar[],
  ventas: VentaDiariaProducto[]
): AsignacionVentas {
  const ordenadas = ordenarLineasFifo(lineas);
  const asignado = new Map<string, number>();
  for (const l of ordenadas) asignado.set(l.id, 0);
  if (ordenadas.length === 0) return asignado;

  const diaCarga = new Map<string, string>();
  for (const l of ordenadas) diaCarga.set(l.id, fechaDiaDeIso(l.fechaRegistro));

  const porFecha = [...ventas].sort((a, b) => a.fecha.localeCompare(b.fecha));

  for (const venta of porFecha) {
    const cantidad = Number(venta.cantidad ?? 0);
    if (!Number.isFinite(cantidad) || cantidad === 0) continue;

    if (cantidad > 0) {
      let restante = cantidad;
      for (const linea of ordenadas) {
        if (restante <= 0) break;
        const dia = diaCarga.get(linea.id) ?? '';
        if (!dia || dia > venta.fecha) continue;
        const yaAsignado = asignado.get(linea.id) ?? 0;
        const capacidad = Math.max(0, Number(linea.cantidadOriginal ?? 0) - yaAsignado);
        if (capacidad <= 0) continue;
        const aplicar = Math.min(capacidad, restante);
        asignado.set(linea.id, redondear2(yaAsignado + aplicar));
        restante = redondear2(restante - aplicar);
      }
      continue;
    }

    // Devolución neta del día: se revierte lo asignado más recientemente en el orden FIFO.
    let aDevolver = -cantidad;
    for (let i = ordenadas.length - 1; i >= 0 && aDevolver > 0; i -= 1) {
      const linea = ordenadas[i];
      const yaAsignado = asignado.get(linea.id) ?? 0;
      if (yaAsignado <= 0) continue;
      const quitar = Math.min(yaAsignado, aDevolver);
      asignado.set(linea.id, redondear2(yaAsignado - quitar));
      aDevolver = redondear2(aDevolver - quitar);
    }
  }

  return asignado;
}
