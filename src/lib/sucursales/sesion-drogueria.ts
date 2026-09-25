import { createAdminClient } from '@/lib/supabase/server';
import { esSucursalDrogueria, esSucursalDrogueriaPorId } from '@/lib/sucursales/drogueria';
import { getSucursalSession } from '@/lib/sucursales/sucursal-session';

/** La sucursal activa de la sesión es droguería (flag firmado en la cookie de sucursal). */
export async function esSesionDrogueria(): Promise<boolean> {
  const suc = await getSucursalSession();
  if (!suc) return false;
  if (suc.esDrogueria) return true;

  // Defensa extra por si la cookie se emitió antes de marcar la sucursal como droguería.
  const sucursalNum = parseInt(suc.id, 10);
  if (Number.isNaN(sucursalNum)) return false;
  if (esSucursalDrogueriaPorId(sucursalNum)) return true;

  const admin = await createAdminClient();
  return esSucursalDrogueria(admin, sucursalNum);
}
