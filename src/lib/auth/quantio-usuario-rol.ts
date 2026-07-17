import type { RolOperador } from '@/lib/auth/roles';
import type { SupabaseClient } from '@supabase/supabase-js';

export function esSiQuantio(valor: unknown): boolean {
  const v = String(valor ?? '').trim().toUpperCase();
  return v === 'S' || v === '1' || v === 'T' || v === 'Y';
}

/** Rol de app según usuarios.Administrador en Quantio. */
export function rolDesdeAdministradorQuantio(administrador: unknown): RolOperador {
  return esSiQuantio(administrador) ? 'admin' : 'operador_sucursal';
}

export async function resolverAppRoleIdPorRol(
  admin: SupabaseClient,
  rol: RolOperador
): Promise<number | null> {
  const { data, error } = await admin
    .from('app_roles')
    .select('id')
    .eq('codigo', rol)
    .maybeSingle();

  if (error) {
    console.warn('resolverAppRoleIdPorRol:', error.message, { rol });
    return null;
  }

  return data?.id ?? null;
}

/** No degradar superadmin asignado manualmente en Supabase. */
export function rolQuantioParaOperadorExistente(
  rolExistente: string | null | undefined,
  administradorQuantio: unknown
): RolOperador {
  if (String(rolExistente ?? '').toLowerCase() === 'superadmin') {
    return 'superadmin';
  }
  return rolDesdeAdministradorQuantio(administradorQuantio);
}
