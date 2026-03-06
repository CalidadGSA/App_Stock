import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';

/** GET /api/sucursales - todas las sucursales activas */
export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, domicilio, activa')
    .eq('activa', true)
    .order('nombrefantasia');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dataMapped = (data ?? []).map((r: { sucursal: number; nombrefantasia: string; domicilio: string | null; activa: boolean }) => ({
    id: String(r.sucursal),
    nombre: r.nombrefantasia,
    codigo_interno: String(r.sucursal),
    ubicacion: r.domicilio,
    activa: r.activa,
  }));
  return NextResponse.json({ data: dataMapped });
}
