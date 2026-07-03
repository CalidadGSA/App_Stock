import { createAdminClient } from '@/lib/supabase/server';
import { filtroSucursalesExcluidasLogin } from '@/lib/sucursales/login-sucursales';
import { NextResponse } from 'next/server';

/** GET /api/auth/sucursales — listado público de sucursales para el dropdown del login (sin auth) */
export async function GET() {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .eq('activa', true)
    .not('sucursal', 'in', filtroSucursalesExcluidasLogin())
    .order('nombrefantasia');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = (data ?? []).map((r: { sucursal: number; nombrefantasia: string }) => ({
    id: String(r.sucursal),
    nombre: r.nombrefantasia,
  }));
  return NextResponse.json({ data: list });
}
