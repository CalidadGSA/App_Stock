import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';

/** GET /api/admin/sucursales - listado de todas las sucursales (solo admin) */
export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .order('nombrefantasia');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list =
    data?.map((r: { sucursal: number; nombrefantasia: string }) => ({
      id: String(r.sucursal),
      nombre: r.nombrefantasia,
    })) ?? [];

  return NextResponse.json({ data: list });
}

