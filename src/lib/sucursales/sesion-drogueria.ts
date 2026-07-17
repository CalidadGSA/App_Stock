import { createAdminClient } from '@/lib/supabase/server';
import { esSucursalDrogueria, esSucursalDrogueriaPorId } from '@/lib/sucursales/drogueria';
import { cookies } from 'next/headers';

export async function esSesionDrogueria(): Promise<boolean> {
  const cookieStore = await cookies();
  const flag = cookieStore.get('sucursal_es_drogueria')?.value;
  if (flag === '1') return true;
  if (flag === '0') return false;

  const sucId = cookieStore.get('sucursal_id')?.value;
  if (!sucId) return false;

  const sucursalNum = parseInt(sucId, 10);
  if (Number.isNaN(sucursalNum)) return false;
  if (esSucursalDrogueriaPorId(sucursalNum)) return true;

  const admin = await createAdminClient();
  return esSucursalDrogueria(admin, sucursalNum);
}

export function setCookieSucursalEsDrogueria(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  esDrogueria: boolean,
  opts: { httpOnly: boolean; path: string; maxAge: number; sameSite: 'lax' }
): void {
  cookieStore.set('sucursal_es_drogueria', esDrogueria ? '1' : '0', opts);
}
