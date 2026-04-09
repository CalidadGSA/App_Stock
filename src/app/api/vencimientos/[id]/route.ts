import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_vencimientos')
    .select('*, sucursales(nombrefantasia), operadores(nombrecompleto), controles_vencimientos_detalle(*)')
    .eq('id', id)
    .eq('sucursal_id', sucursalId ?? '')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const payload = data as {
    controles_vencimientos_detalle?: Array<{ eliminado?: number }>;
  };
  if (payload?.controles_vencimientos_detalle?.length) {
    payload.controles_vencimientos_detalle = payload.controles_vencimientos_detalle.filter(
      (d) => Number(d.eliminado ?? 0) !== 1
    );
  }
  return NextResponse.json({ data: payload });
}
