/**
 * Valorización de un control de inventario: se calcula al cerrarlo y se guarda en
 * `controles_inventario` (migración 033).
 *
 * Guarda tres números por control:
 *  - `stock_controlado_costo`: el stock teórico de **todas** las líneas contadas, a costo.
 *    Es el denominador correcto del KPI de diferencias: los faltantes solo se pueden comparar
 *    contra lo que efectivamente se revisó.
 *  - `dif_negativa_costo` / `dif_positiva_costo`: faltantes y sobrantes a costo.
 *
 * Se calcula una sola vez porque recorrer el detalle de todos los controles de un mes son
 * decenas de miles de líneas. Además queda con el costo del momento del conteo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCostosMedicamentosOnze, getUnidadesPorCajaOnze } from '@/lib/legacy-db/onze-medicamentos';
import { cajasEquivalentes } from '@/lib/inventario/diferencia-valorizada';

const DETALLE_CHUNK = 1000;

export interface ValorizacionControl {
  lineas_controladas: number;
  stock_controlado_costo: number;
  dif_negativa_costo: number;
  dif_positiva_costo: number;
}

type FilaDetalle = {
  producto_id_sistema: string | null;
  stock_sist_cajas: number | string | null;
  stock_sist_unidades: number | string | null;
  stock_real_cajas: number | string | null;
  stock_real_unidades: number | string | null;
  con_diferencias: number | null;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/** Recorre el detalle del control y lo valoriza con los costos de onze_center. */
export async function calcularValorizacionControl(
  admin: SupabaseClient,
  controlId: string
): Promise<ValorizacionControl> {
  const filas: FilaDetalle[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias'
      )
      .eq('control_id', controlId)
      .range(offset, offset + DETALLE_CHUNK - 1);

    if (error) throw new Error(error.message);
    const lote = (data ?? []) as FilaDetalle[];
    filas.push(...lote);
    if (lote.length < DETALLE_CHUNK) break;
    offset += DETALLE_CHUNK;
  }

  if (filas.length === 0) {
    return {
      lineas_controladas: 0,
      stock_controlado_costo: 0,
      dif_negativa_costo: 0,
      dif_positiva_costo: 0,
    };
  }

  const ids = Array.from(
    new Set(
      filas
        .map((f) => String(f.producto_id_sistema ?? '').trim())
        .filter((id) => id.length > 0)
    )
  );

  const [{ costos }, unidadesPorCaja] = await Promise.all([
    getCostosMedicamentosOnze(ids),
    getUnidadesPorCajaOnze(ids),
  ]);

  let stockControlado = 0;
  let negativa = 0;
  let positiva = 0;

  for (const f of filas) {
    const id = String(f.producto_id_sistema ?? '').trim();
    if (!id) continue;
    const costo = costos.get(id) ?? 0;
    if (costo === 0) continue;
    const upc = unidadesPorCaja.get(id);

    stockControlado +=
      cajasEquivalentes(n(f.stock_sist_cajas), n(f.stock_sist_unidades), upc) * costo;

    if (Number(f.con_diferencias ?? 0) !== 1) continue;

    const dif = cajasEquivalentes(
      n(f.stock_real_cajas) - n(f.stock_sist_cajas),
      n(f.stock_real_unidades) - n(f.stock_sist_unidades),
      upc
    );
    const valor = dif * costo;
    if (valor < 0) negativa += -valor;
    else positiva += valor;
  }

  const redondear = (v: number) => Math.round(v * 100) / 100;

  return {
    lineas_controladas: filas.length,
    stock_controlado_costo: redondear(stockControlado),
    dif_negativa_costo: redondear(negativa),
    dif_positiva_costo: redondear(positiva),
  };
}

/**
 * Calcula y guarda la valorización. No propaga errores: si falla, el control queda sin
 * valorizar (`valorizado_at` null) y el cierre sigue adelante. El KPI lo muestra como faltante
 * de dato en vez de como cero.
 */
export async function valorizarYGuardarControl(
  admin: SupabaseClient,
  controlId: string,
  fechaIso: string
): Promise<ValorizacionControl | null> {
  try {
    const valores = await calcularValorizacionControl(admin, controlId);

    const { error } = await admin
      .from('controles_inventario')
      .update({ ...valores, valorizado_at: fechaIso })
      .eq('id', controlId);

    if (error) {
      // La columna puede no existir todavía (migración 033 sin aplicar).
      console.warn('valorizarYGuardarControl:', error.message, { controlId });
      return null;
    }

    return valores;
  } catch (e) {
    console.warn(
      'valorizarYGuardarControl:',
      e instanceof Error ? e.message : String(e),
      { controlId }
    );
    return null;
  }
}

export interface ValorizacionSucursalMes {
  controles: number;
  /** Controles cerrados del período que todavía no tienen los montos calculados. */
  sin_valorizar: number;
  lineas_controladas: number;
  stock_controlado_costo: number;
  dif_negativa_costo: number;
  dif_positiva_costo: number;
}

export function valorizacionVacia(): ValorizacionSucursalMes {
  return {
    controles: 0,
    sin_valorizar: 0,
    lineas_controladas: 0,
    stock_controlado_costo: 0,
    dif_negativa_costo: 0,
    dif_positiva_costo: 0,
  };
}

/**
 * Suma por sucursal lo valorizado en los controles cerrados del período.
 *
 * Son pocas filas (una por control), así que una consulta alcanza para todas las sucursales.
 * Devuelve `null` si las columnas todavía no existen (migración 033 sin aplicar).
 */
export async function sumarValorizacionPorSucursal(
  admin: SupabaseClient,
  desdeIso: string,
  hastaIso: string,
  sucursalIds?: number[]
): Promise<Map<number, ValorizacionSucursalMes> | null> {
  let q = admin
    .from('controles_inventario')
    .select(
      'sucursal_id, lineas_controladas, stock_controlado_costo, dif_negativa_costo, dif_positiva_costo, valorizado_at'
    )
    .eq('estado', 'cerrado')
    .gte('fecha_fin', desdeIso)
    .lte('fecha_fin', hastaIso)
    .limit(5000);

  if (sucursalIds && sucursalIds.length > 0) q = q.in('sucursal_id', sucursalIds);

  const { data, error } = await q;

  if (error) {
    if (/stock_controlado_costo|valorizado_at|column/i.test(error.message)) return null;
    console.warn('sumarValorizacionPorSucursal:', error.message);
    return null;
  }

  type Fila = {
    sucursal_id: number;
    lineas_controladas: number | null;
    stock_controlado_costo: number | string | null;
    dif_negativa_costo: number | string | null;
    dif_positiva_costo: number | string | null;
    valorizado_at: string | null;
  };

  const out = new Map<number, ValorizacionSucursalMes>();
  for (const row of (data ?? []) as Fila[]) {
    const suc = Number(row.sucursal_id);
    const acc = out.get(suc) ?? valorizacionVacia();
    acc.controles += 1;
    if (!row.valorizado_at) {
      acc.sin_valorizar += 1;
    } else {
      acc.lineas_controladas += n(row.lineas_controladas);
      acc.stock_controlado_costo += n(row.stock_controlado_costo);
      acc.dif_negativa_costo += n(row.dif_negativa_costo);
      acc.dif_positiva_costo += n(row.dif_positiva_costo);
    }
    out.set(suc, acc);
  }

  return out;
}
