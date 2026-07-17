import type { SupabaseClient } from '@supabase/supabase-js';

/** Vueltas de psicotrópicos por trimestre cuando la sucursal no tiene valor configurado. */
export const VUELTAS_PSICOS_DEFAULT = 4;

/** Seed inicial por sucursal (sucursal_id → vueltas). */
export const VUELTAS_PSICOS_POR_SUCURSAL: Readonly<Record<number, number>> = {
  1: 3,
  2: 5,
  3: 4,
  4: 3,
  5: 4,
  6: 4,
  7: 4,
  8: 3,
  11: 4,
  12: 4,
  16: 4,
  17: 4,
  19: 5,
  20: 4,
  21: 3,
};

export function normalizarVueltasPsicos(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 1) return VUELTAS_PSICOS_DEFAULT;
  return Math.floor(n);
}

export async function leerVueltasPsicosSucursal(
  admin: SupabaseClient,
  sucursalId: number
): Promise<number> {
  const { data, error } = await admin
    .from('sucursales')
    .select('vueltas_psicos')
    .eq('sucursal', sucursalId)
    .maybeSingle();

  if (error) {
    console.warn('leerVueltasPsicosSucursal:', error.message, { sucursalId });
    return VUELTAS_PSICOS_POR_SUCURSAL[sucursalId] ?? VUELTAS_PSICOS_DEFAULT;
  }

  const raw = (data as { vueltas_psicos?: number | null } | null)?.vueltas_psicos;
  if (raw == null) {
    return VUELTAS_PSICOS_POR_SUCURSAL[sucursalId] ?? VUELTAS_PSICOS_DEFAULT;
  }
  return normalizarVueltasPsicos(raw);
}

export type SumaVecesPsicotropicos = {
  cantidadProductos: number;
  sumaVecesInventariado: number;
};

/** Suma vecesinventariado de todos los PSICOTROPICOS del trimestre en base_productos. */
export async function sumarVecesInventariadoPsicotropicos(
  admin: SupabaseClient,
  sucursalId: number,
  trimestreDb: string,
  columnVariant: { id: string; trim: string; veces: string }
): Promise<SumaVecesPsicotropicos> {
  const chunkSize = 1000;
  let offset = 0;
  let cantidadProductos = 0;
  let sumaVecesInventariado = 0;

  while (true) {
    const { data, error } = await admin
      .from('base_productos')
      .select(columnVariant.veces)
      .eq(columnVariant.id, sucursalId)
      .eq(columnVariant.trim, trimestreDb)
      .ilike('categoriamacro', 'PSICOTROPICOS')
      .range(offset, offset + chunkSize - 1);

    if (error) {
      console.error('sumarVecesInventariadoPsicotropicos:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      const veces = Number((row as unknown as Record<string, unknown>)[columnVariant.veces] ?? 0);
      cantidadProductos += 1;
      sumaVecesInventariado += Number.isFinite(veces) && veces > 0 ? veces : 0;
    }

    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  return { cantidadProductos, sumaVecesInventariado };
}

export function calcularProgresoPsicotropicos(
  cantidadProductos: number,
  sumaVecesInventariado: number,
  vueltasPsicos: number
): { total: number; inventariados: number; pendientes: number; porcentaje: number } {
  const vueltas = normalizarVueltasPsicos(vueltasPsicos);
  const total = cantidadProductos * vueltas;
  const inventariados = sumaVecesInventariado;
  const pendientes = Math.max(0, total - sumaVecesInventariado);
  const porcentaje =
    total > 0 ? Math.min(100, Math.round((sumaVecesInventariado / total) * 100)) : 0;
  return { total, inventariados, pendientes, porcentaje };
}
