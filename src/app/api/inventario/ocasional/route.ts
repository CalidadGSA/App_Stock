import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST /api/inventario/ocasional - crear inventario ocasional (solo admin) */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  let body: { descripcion?: string } = {};
  try {
    body = (await request.json()) as { descripcion?: string };
  } catch {
    // descripción opcional
  }

  const descripcion =
    body.descripcion && body.descripcion.trim().length > 0
      ? body.descripcion.trim()
      : 'Inventario ocasional';

  const { data, error } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: 'Auditoria',
      descripcion,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Error al crear inventario ocasional' },
      { status: 500 }
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}

