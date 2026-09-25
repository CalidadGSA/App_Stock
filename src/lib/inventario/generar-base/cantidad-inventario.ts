/**
 * Cuánto hay que inventariar por día en cada sucursal y categoría macro.
 *
 * Es el total de la categoría repartido entre los días hábiles del trimestre. Los
 * psicotrópicos se multiplican por las vueltas configuradas para la sucursal
 * (`sucursales.vueltas_psicos`), que es lo que la app usa para medir el progreso.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { contarDiasHabiles } from '@/lib/fechas/feriados-argentina';
import { normalizarVueltasPsicos, VUELTAS_PSICOS_DEFAULT } from '@/lib/inventario/vueltas-psicos-sucursal';
import type { CategoriaMacro } from '@/lib/inventario/generar-base/padron';

export interface FilaCantidadInventario {
  idSucursal: number;
  categoriaMacro: string;
  trimestre: string;
  cantidadTotal: number;
  cantidadDiaria: number;
  dias: number;
}

export interface EntradaCantidad {
  idsucursal: number;
  categoriamacro: CategoriaMacro;
}

/** Vueltas de psicotrópicos por sucursal, desde la configuración de la app. */
export async function leerVueltasPsicos(
  admin: SupabaseClient,
  sucursales: number[]
): Promise<Map<number, number>> {
  const vueltas = new Map<number, number>();
  if (sucursales.length === 0) return vueltas;

  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, vueltas_psicos')
    .in('sucursal', sucursales);

  if (error) {
    console.warn('leerVueltasPsicos:', error.message);
    for (const s of sucursales) vueltas.set(s, VUELTAS_PSICOS_DEFAULT);
    return vueltas;
  }

  for (const s of sucursales) vueltas.set(s, VUELTAS_PSICOS_DEFAULT);
  for (const row of (data ?? []) as Array<{ sucursal: number; vueltas_psicos: unknown }>) {
    vueltas.set(Number(row.sucursal), normalizarVueltasPsicos(row.vueltas_psicos));
  }

  return vueltas;
}

export function construirCantidadInventario(opts: {
  entradas: EntradaCantidad[];
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  /** Sucursal → vueltas de psicotrópicos. Sin entrada, no se multiplica. */
  vueltasPsicos: Map<number, number>;
}): FilaCantidadInventario[] {
  const { entradas, trimestre, fechaInicio, fechaFin, vueltasPsicos } = opts;

  const dias = contarDiasHabiles(fechaInicio, fechaFin);
  if (dias <= 0) {
    throw new Error(`El trimestre ${trimestre} no tiene días hábiles (${fechaInicio} a ${fechaFin}).`);
  }

  const totales = new Map<string, { idSucursal: number; categoriaMacro: string; total: number }>();

  for (const e of entradas) {
    const clave = `${e.idsucursal}|${e.categoriamacro}`;
    const actual = totales.get(clave);
    if (actual) actual.total += 1;
    else
      totales.set(clave, {
        idSucursal: e.idsucursal,
        categoriaMacro: e.categoriamacro,
        total: 1,
      });
  }

  const filas: FilaCantidadInventario[] = [];

  for (const { idSucursal, categoriaMacro, total } of totales.values()) {
    let cantidadDiaria = Math.ceil(total / dias);

    if (categoriaMacro === 'Psicotropicos') {
      const vueltas = vueltasPsicos.get(idSucursal);
      if (vueltas && vueltas > 1) cantidadDiaria = Math.ceil(cantidadDiaria * vueltas);
    }

    filas.push({
      idSucursal,
      categoriaMacro,
      trimestre,
      cantidadTotal: total,
      cantidadDiaria,
      dias,
    });
  }

  filas.sort((a, b) =>
    a.idSucursal !== b.idSucursal
      ? a.idSucursal - b.idSucursal
      : a.categoriaMacro.localeCompare(b.categoriaMacro, 'es')
  );

  return filas;
}
