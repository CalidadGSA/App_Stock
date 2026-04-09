import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET ?control_id=&producto_id=&fechas=YYYY-MM-DD,YYYY-MM-DD
 * Indica si ya existe línea (mismo producto + fecha venc.) en otro control de la misma sucursal.
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const controlId = searchParams.get('control_id') ?? '';
  const productoId = String(searchParams.get('producto_id') ?? '').trim();
  const fechasRaw = String(searchParams.get('fechas') ?? '').trim();
  if (!controlId || !productoId || !fechasRaw) {
    return NextResponse.json({ error: 'control_id, producto_id y fechas requeridos' }, { status: 400 });
  }

  const fechas = fechasRaw
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (fechas.length === 0) {
    return NextResponse.json({ data: { duplicados_por_fecha: {} as Record<string, boolean> } });
  }

  const admin = await createAdminClient();

  const { data: cab, error: cabErr } = await admin
    .from('controles_vencimientos')
    .select('id, sucursal_id')
    .eq('id', controlId)
    .maybeSingle();
  if (cabErr) return NextResponse.json({ error: cabErr.message }, { status: 500 });
  if (!cab || String(cab.sucursal_id) !== String(sucursalCookie)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  const { data: hits, error } = await admin
    .from('controles_vencimientos_detalle')
    .select('fecha_vencimiento, controles_vencimientos!inner(sucursal_id, id)')
    .eq('producto_id_sistema', productoId)
    .in('fecha_vencimiento', fechas)
    .neq('control_id', controlId)
    .eq('controles_vencimientos.sucursal_id', parseInt(sucursalCookie, 10))
    .eq('eliminado', 0);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const duplicados_por_fecha: Record<string, boolean> = {};
  for (const f of fechas) {
    duplicados_por_fecha[f] = false;
  }
  for (const row of hits ?? []) {
    const r = row as { fecha_vencimiento?: string };
    const fv = String(r.fecha_vencimiento ?? '');
    if (fv in duplicados_por_fecha) duplicados_por_fecha[fv] = true;
  }

  return NextResponse.json({ data: { duplicados_por_fecha } });
}
