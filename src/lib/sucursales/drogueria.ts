import type { SupabaseClient } from '@supabase/supabase-js';

export const OPERADOR_FUENTE_ONZE = 'onze';
export const OPERADOR_FUENTE_QUANTIO = 'quantio';

/** Sucursal droguería central en Supabase (Quantio). */
export const SUCURSAL_ID_DROGUERIA = 13;

/** Desplazamiento de IDs para no colisionar con operadores Onze. */
export const QUANTIO_OPERADOR_ID_OFFSET = 10_000_000;

export function idOperadorQuantioDesdeLegacy(idUsuario: number): number {
  return QUANTIO_OPERADOR_ID_OFFSET + Number(idUsuario);
}

export function idUsuarioQuantioDesdeOperador(idOperador: number): number | null {
  const n = Number(idOperador);
  if (!Number.isFinite(n) || n < QUANTIO_OPERADOR_ID_OFFSET) return null;
  return n - QUANTIO_OPERADOR_ID_OFFSET;
}

export function esSucursalDrogueriaPorId(sucursalId: number): boolean {
  return Number(sucursalId) === SUCURSAL_ID_DROGUERIA;
}

export async function esSucursalDrogueria(
  admin: SupabaseClient,
  sucursalId: number
): Promise<boolean> {
  if (!Number.isFinite(sucursalId)) return false;
  if (esSucursalDrogueriaPorId(sucursalId)) return true;

  const { data, error } = await admin
    .from('sucursales')
    .select('es_drogueria')
    .eq('sucursal', sucursalId)
    .maybeSingle();

  if (error) {
    // Columna es_drogueria aún no migrada: id 13 sigue siendo droguería.
    if (error.message?.includes('es_drogueria')) {
      return esSucursalDrogueriaPorId(sucursalId);
    }
    console.warn('esSucursalDrogueria:', error.message, { sucursalId });
    return false;
  }

  return Boolean((data as { es_drogueria?: boolean } | null)?.es_drogueria);
}

export function fuenteOperadorParaSucursal(esDrogueria: boolean): string {
  return esDrogueria ? OPERADOR_FUENTE_QUANTIO : OPERADOR_FUENTE_ONZE;
}
