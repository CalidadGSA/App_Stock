import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/** GET /api/sucursales - todas las sucursales activas */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('id, nombre, codigo_interno, ubicacion, activa')
    .eq('activa', true)
    .order('nombre');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
