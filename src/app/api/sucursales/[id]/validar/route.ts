import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { isAdminLikeRole } from '@/lib/auth/roles';
import { esSucursalDrogueria } from '@/lib/sucursales/drogueria';
import { setCookieSucursalEsDrogueria } from '@/lib/sucursales/sesion-drogueria';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CAMBIO_SUCURSAL_COOKIE, SUCURSAL_SESSION_MAX_AGE_SEC } from '@/lib/auth/cookie-config';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: sucursalId } = await params;
  const omitirContraseña = isAdminLikeRole(operador.rol);

  let body: { password?: string } = {};
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    body = {};
  }

  if (!omitirContraseña && !body.password?.trim()) {
    return NextResponse.json({ error: 'Contraseña requerida' }, { status: 400 });
  }

  const sucursalIdNum = parseInt(sucursalId, 10);
  if (Number.isNaN(sucursalIdNum)) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });

  const admin = await createAdminClient();
  const { data: sucursal, error: sucError } = await admin
    .from('sucursales')
    .select('*')
    .eq('sucursal', sucursalIdNum)
    .single();

  if (sucError || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
  }

  if (!sucursal.activa) {
    return NextResponse.json({ error: 'Sucursal inactiva' }, { status: 403 });
  }

  if (!omitirContraseña) {
    const valid = sucursal.contraseña === body.password;
    if (!valid) {
      return NextResponse.json({ error: 'Contraseña de sucursal incorrecta' }, { status: 401 });
    }
  }

  const sucursalEsDrogueria = await esSucursalDrogueria(admin, sucursalIdNum);
  const operadorEsQuantio = operador.idoperador >= 10_000_000;
  if (!omitirContraseña && sucursalEsDrogueria !== operadorEsQuantio) {
    return NextResponse.json(
      { error: 'Este operador no corresponde a la sucursal seleccionada' },
      { status: 403 }
    );
  }

  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    path: '/',
    maxAge: SUCURSAL_SESSION_MAX_AGE_SEC,
    sameSite: 'lax' as const,
  };
  cookieStore.set('sucursal_id', String(sucursal.sucursal), cookieOpts);
  cookieStore.set('sucursal_nombre', sucursal.nombrefantasia, cookieOpts);
  cookieStore.set('sucursal_codigo', String(sucursal.sucursal), cookieOpts);
  setCookieSucursalEsDrogueria(cookieStore, sucursalEsDrogueria, cookieOpts);
  cookieStore.delete(CAMBIO_SUCURSAL_COOKIE);

  return NextResponse.json({ data: { id: String(sucursal.sucursal), nombre: sucursal.nombrefantasia, codigo_interno: String(sucursal.sucursal) } });
}
