import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';

type DevolucionRow = {
  id: string;
  fecha: string;
  sucursal_id: number;
  usuario_id: number;
  // datos opcionales para mostrar en la UI
  sucursales?: {
    nombrefantasia?: string | null;
  } | null;
  operadores?: {
    nombrecompleto?: string | null;
  } | null;
  categoria_macro?: string | null;
};

export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde') || undefined;
  const hasta = searchParams.get('hasta') || undefined;
  const categoriaMacro = searchParams.get('categoria_macro') || undefined;

  const admin = await createAdminClient();

  // Si se filtra por categoría, usamos la tabla de detalle y deduplicamos en memoria
  if (categoriaMacro) {
    const query = admin
      .from('devoluciones_vencimientos_detalle')
      .select(
        'categoria_macro, devoluciones_vencimientos!inner(id, fecha, sucursal_id, usuario_id, sucursales(nombrefantasia), operadores(nombrecompleto))'
      )
      .eq('devoluciones_vencimientos.sucursal_id', parseInt(sucursalId, 10))
      .eq('categoria_macro', categoriaMacro);

    if (desde) {
      query.gte('devoluciones_vencimientos.fecha', desde);
    }
    if (hasta) {
      query.lte('devoluciones_vencimientos.fecha', hasta);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as any[];
    const mapa = new Map<string, DevolucionRow>();

    for (const r of rows) {
      const cab = r.devoluciones_vencimientos;
      if (!cab) continue;
      const id = cab.id as string;
      if (!mapa.has(id)) {
        mapa.set(id, {
          id,
          fecha: cab.fecha as string,
          sucursal_id: cab.sucursal_id as number,
          usuario_id: cab.usuario_id as number,
          sucursales: cab.sucursales ?? null,
          operadores: cab.operadores ?? null,
          categoria_macro: (r.categoria_macro as string | null) ?? null,
        });
      }
    }

    return NextResponse.json({
      data: Array.from(mapa.values()),
    });
  }

  // Sin filtro de categoría: listamos directamente las devoluciones
  const query = admin
    .from('devoluciones_vencimientos')
    .select('id, fecha, sucursal_id, usuario_id, sucursales(nombrefantasia), operadores(nombrecompleto)')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .order('fecha', { ascending: false });

  if (desde) {
    query.gte('fecha', desde);
  }
  if (hasta) {
    query.lte('fecha', hasta);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items: DevolucionRow[] =
    (data ?? []).map((r: any) => ({
      id: r.id as string,
      fecha: r.fecha as string,
      sucursal_id: r.sucursal_id as number,
      usuario_id: r.usuario_id as number,
      sucursales: (r.sucursales as any) ?? null,
      operadores: (r.operadores as any) ?? null,
      categoria_macro: null, // solo se completa cuando se filtra por categoría
    })) ?? [];

  return NextResponse.json({
    data: items,
  });
}

