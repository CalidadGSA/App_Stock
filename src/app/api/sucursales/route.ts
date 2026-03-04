import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/** GET /api/sucursales - sucursales asignadas al usuario autenticado */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('usuarios_sucursales')
    .select('sucursales(id, nombre, codigo_interno, ubicacion, activa)')
    .eq('usuario_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sucursales = (data ?? [])
    .map((row: { sucursales: unknown }) => row.sucursales)
    .filter((s: unknown) => s && typeof s === 'object' && (s as Record<string, unknown>).activa);

  return NextResponse.json({ data: sucursales });
}
