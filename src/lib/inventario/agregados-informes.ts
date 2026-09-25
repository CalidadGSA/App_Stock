/**
 * Agregados por sucursal para los informes mensual y trimestral, resueltos en Postgres.
 *
 * Las dos consultas más caras de esas pantallas se hacían por sucursal y traían miles de filas
 * por PostgREST para contarlas en Node. Con las funciones de la migración 030 se resuelven en
 * una sola llamada para todas las sucursales.
 *
 * Si la migración todavía no está aplicada, las funciones devuelven `null` y el llamador sigue
 * por el camino viejo: la pantalla anda igual, solo más lenta.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rangoFechasArgentinaIso } from '@/lib/utils';
import {
  calcularProgresoPsicotropicos,
  VUELTAS_PSICOS_DEFAULT,
} from '@/lib/inventario/vueltas-psicos-sucursal';
import type { ProgresoTrimestreMacro } from '@/lib/inventario/trimestre-base';

const MACROS: ReadonlyArray<ProgresoTrimestreMacro['macro']> = [
  'FARMA',
  'BIENESTAR',
  'PSICOTROPICOS',
];

/** Una función que falta (migración sin aplicar) no es un error a propagar: se cae al camino viejo. */
function faltaLaFuncion(mensaje: string): boolean {
  return /does not exist|could not find the function|schema cache|PGRST202/i.test(mensaje);
}

/**
 * Productos distintos con diferencia por sucursal en el período.
 * `auditoria=false` son los controles de sucursal, que es lo que muestran los informes.
 */
export async function cargarProductosConDiferenciaPorSucursal(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string,
  auditoria = false
): Promise<Map<number, number> | null> {
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fechaInicio, fechaFin);

  const { data, error } = await admin.rpc('admin_productos_con_diferencia_por_sucursal', {
    p_desde: desdeIso,
    p_hasta: hastaIso,
    p_auditoria: auditoria,
  });

  if (error) {
    if (!faltaLaFuncion(error.message)) {
      console.warn('cargarProductosConDiferenciaPorSucursal:', error.message);
    }
    return null;
  }

  const out = new Map<number, number>();
  for (const row of (data ?? []) as Array<{ sucursal_id: number; productos: number }>) {
    out.set(Number(row.sucursal_id), Number(row.productos ?? 0));
  }
  return out;
}

/**
 * Avance del padrón por sucursal y categoría macro, con el mismo formato que
 * `obtenerProgresoPorTrimestreLabel`. Los psicotrópicos cuentan vueltas completas.
 */
export async function cargarProgresoBasePorSucursal(
  admin: SupabaseClient,
  trimestre: string,
  vueltasPsicos: Map<number, number>
): Promise<Map<number, ProgresoTrimestreMacro[]> | null> {
  if (!trimestre.trim()) return null;

  const { data, error } = await admin.rpc('admin_progreso_base_productos', {
    p_trimestre: trimestre,
  });

  if (error) {
    if (!faltaLaFuncion(error.message)) {
      console.warn('cargarProgresoBasePorSucursal:', error.message);
    }
    return null;
  }

  type Fila = {
    idsucursal: number;
    categoriamacro: string;
    total: number;
    inventariados: number;
    suma_veces: number;
  };

  const porSucursal = new Map<number, Map<string, Fila>>();
  for (const row of (data ?? []) as Fila[]) {
    const suc = Number(row.idsucursal);
    if (!Number.isFinite(suc)) continue;
    const macro = String(row.categoriamacro ?? '').trim().toUpperCase();
    let m = porSucursal.get(suc);
    if (!m) {
      m = new Map<string, Fila>();
      porSucursal.set(suc, m);
    }
    m.set(macro, row);
  }

  const out = new Map<number, ProgresoTrimestreMacro[]>();
  for (const [suc, porMacro] of porSucursal) {
    const vueltas = vueltasPsicos.get(suc) ?? VUELTAS_PSICOS_DEFAULT;

    out.set(
      suc,
      MACROS.map((macro) => {
        const fila = porMacro.get(macro);
        const productos = Number(fila?.total ?? 0);

        if (macro === 'PSICOTROPICOS') {
          const psico = calcularProgresoPsicotropicos(
            productos,
            Number(fila?.suma_veces ?? 0),
            vueltas
          );
          return {
            macro,
            total: psico.total,
            inventariados: psico.inventariados,
            pendientes: psico.pendientes,
            porcentaje: psico.porcentaje,
          };
        }

        const inventariados = Number(fila?.inventariados ?? 0);
        return {
          macro,
          total: productos,
          inventariados,
          pendientes: Math.max(0, productos - inventariados),
          porcentaje: productos > 0 ? Math.round((inventariados / productos) * 100) : 0,
        };
      })
    );
  }

  return out;
}

/** Totales de un arreglo por macro, igual que `totalesDesdeProgresoPorMacro`. */
export function totalesProgresoMacro(porMacro: ProgresoTrimestreMacro[]): {
  total: number;
  inventariados: number;
  pendientes: number;
  porcentaje: number;
} {
  const total = porMacro.reduce((acc, m) => acc + m.total, 0);
  const inventariados = porMacro.reduce((acc, m) => acc + m.inventariados, 0);
  return {
    total,
    inventariados,
    pendientes: Math.max(0, total - inventariados),
    porcentaje: total > 0 ? Math.round((inventariados / total) * 100) : 0,
  };
}
