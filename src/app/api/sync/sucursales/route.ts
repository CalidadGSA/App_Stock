import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { syncSucursalesFromLegacy } from '@/lib/legacy-db/syncLegacy';

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const { data: perfil, error: perfilError } = await admin
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (perfilError || !perfil || perfil.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  try {
    const result = await syncSucursalesFromLegacy();
    return NextResponse.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

