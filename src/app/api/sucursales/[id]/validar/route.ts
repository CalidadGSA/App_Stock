import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sucursalId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const body = await request.json() as { password: string };
  if (!body.password) {
    return NextResponse.json({ error: 'Contraseña requerida' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Obtener hash de la sucursal
  const { data: sucursal, error: sucError } = await admin
    .from('sucursales')
    .select('id, nombre, codigo_interno, password_hash, activa')
    .eq('id', sucursalId)
    .single();

  if (sucError || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
  }

  if (!sucursal.activa) {
    return NextResponse.json({ error: 'Sucursal inactiva' }, { status: 403 });
  }

  const valid = await bcrypt.compare(body.password, sucursal.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Contraseña de sucursal incorrecta' }, { status: 401 });
  }

  // Guardar sucursal en cookie (httpOnly)
  const cookieStore = await cookies();
  const cookieOpts = { httpOnly: true, path: '/', maxAge: 60 * 60 * 12, sameSite: 'lax' as const };
  cookieStore.set('sucursal_id', sucursal.id, cookieOpts);
  cookieStore.set('sucursal_nombre', sucursal.nombre, cookieOpts);
  cookieStore.set('sucursal_codigo', sucursal.codigo_interno, cookieOpts);

  return NextResponse.json({ data: { id: sucursal.id, nombre: sucursal.nombre, codigo_interno: sucursal.codigo_interno } });
}
