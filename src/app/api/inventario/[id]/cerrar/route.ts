import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST /api/inventario/[id]/cerrar */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const admin = await createAdminClient();
  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  if (String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Ya está cerrado' }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('controles_inventario')
    .update({ estado: 'cerrado', fecha_fin: now, updated_at: now })
    .eq('id', controlId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
