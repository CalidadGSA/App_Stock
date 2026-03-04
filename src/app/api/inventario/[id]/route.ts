import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** GET /api/inventario/[id] - obtener un control con sus detalles */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_inventario')
    .select('*, sucursales(nombre, codigo_interno), usuarios(nombre), controles_inventario_detalle(*)')
    .eq('id', id)
    .eq('sucursal_id', sucursalId ?? '')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ data });
}
