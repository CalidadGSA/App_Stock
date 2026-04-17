import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** GET /api/vencimientos - listar controles de vencimientos (con paginación y filtros) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  const estado = searchParams.get('estado');

  let query = admin
    .from('controles_vencimientos')
    .select('*, sucursales(nombrefantasia), operadores(nombrecompleto)', { count: 'exact' })
    .eq('sucursal_id', sucursalId);

  if (desde) {
    query = query.gte('fecha_inicio', desde);
  }
  if (hasta) {
    query = query.lte('fecha_inicio', `${hasta}T23:59:59.999Z`);
  }
  if (estado === 'en_progreso' || estado === 'cerrado') {
    query = query.eq('estado', estado);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    data: data ?? [],
    total: count ?? data?.length ?? 0,
    page,
    pageSize,
  });
}

export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const body = await request.json() as { observaciones?: string; categoria_macro?: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null };

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_vencimientos')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      observaciones: body.observaciones ?? null,
      categoria_macro: body.categoria_macro ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
