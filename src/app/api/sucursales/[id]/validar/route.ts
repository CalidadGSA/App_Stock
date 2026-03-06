import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: sucursalId } = await params;
  const body = await request.json() as { password: string };
  if (!body.password) return NextResponse.json({ error: 'Contraseña requerida' }, { status: 400 });

  const sucursalIdNum = parseInt(sucursalId, 10);
  if (Number.isNaN(sucursalIdNum)) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });

  const admin = await createAdminClient();
  const { data: sucursal, error: sucError } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, contraseña, activa')
    .eq('sucursal', sucursalIdNum)
    .single();

  if (sucError || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
  }

  if (!sucursal.activa) {
    return NextResponse.json({ error: 'Sucursal inactiva' }, { status: 403 });
  }

  const valid = sucursal.contraseña === body.password;
  if (!valid) {
    return NextResponse.json({ error: 'Contraseña de sucursal incorrecta' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const cookieOpts = { httpOnly: true, path: '/', maxAge: 60 * 60 * 12, sameSite: 'lax' as const };
  cookieStore.set('sucursal_id', String(sucursal.sucursal), cookieOpts);
  cookieStore.set('sucursal_nombre', sucursal.nombrefantasia, cookieOpts);
  cookieStore.set('sucursal_codigo', String(sucursal.sucursal), cookieOpts);

  return NextResponse.json({ data: { id: String(sucursal.sucursal), nombre: sucursal.nombrefantasia, codigo_interno: String(sucursal.sucursal) } });
}
