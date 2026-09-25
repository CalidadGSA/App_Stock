import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';

/** Cabecera de devolución tal como la devuelve PostgREST (con joins). */
type DevolucionCabeceraJoin = {
  id?: string;
  fecha?: string;
  sucursal_id?: number;
  usuario_id?: number;
  sucursales?: { nombrefantasia?: string | null } | null;
  operadores?: { nombrecompleto?: string | null } | null;
};

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
  /** Líneas de detalle de la devolución (para resumen de observaciones en el listado). */
  lineas_detalle?: number;
  lineas_con_observacion?: number;
};

async function adjuntarResumenObservaciones(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  items: DevolucionRow[]
): Promise<DevolucionRow[]> {
  if (items.length === 0) return items;
  const ids = items.map((i) => i.id);
  const { data: dets, error } = await admin
    .from('devoluciones_vencimientos_detalle')
    .select('devolucion_id, accion_observacion')
    .in('devolucion_id', ids);

  if (error) {
    console.error('adjuntarResumenObservaciones', error);
    return items;
  }

  const stats = new Map<string, { total: number; conObs: number }>();
  for (const row of dets ?? []) {
    const r = row as { devolucion_id: string; accion_observacion: string | null };
    const did = String(r.devolucion_id);
    const s = stats.get(did) ?? { total: 0, conObs: 0 };
    s.total++;
    if (String(r.accion_observacion ?? '').trim()) s.conObs++;
    stats.set(did, s);
  }

  return items.map((i) => {
    const s = stats.get(i.id);
    return {
      ...i,
      lineas_detalle: s?.total ?? 0,
      lineas_con_observacion: s?.conObs ?? 0,
    };
  });
}

export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const sucursalId = await getSucursalIdSesion();
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

    const rows = (data ?? []) as Array<{
      categoria_macro?: string | null;
      devoluciones_vencimientos?: DevolucionCabeceraJoin | null;
    }>;
    const mapa = new Map<string, DevolucionRow>();

    for (const r of rows) {
      const cab = r.devoluciones_vencimientos;
      if (!cab?.id) continue;
      const id = cab.id;
      if (!mapa.has(id)) {
        mapa.set(id, {
          id,
          fecha: String(cab.fecha ?? ''),
          sucursal_id: Number(cab.sucursal_id ?? 0),
          usuario_id: Number(cab.usuario_id ?? 0),
          sucursales: cab.sucursales ?? null,
          operadores: cab.operadores ?? null,
          categoria_macro: r.categoria_macro ?? null,
        });
      }
    }

    const enriched = await adjuntarResumenObservaciones(
      admin,
      Array.from(mapa.values())
    );
    return NextResponse.json({
      data: enriched,
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
    ((data ?? []) as DevolucionCabeceraJoin[]).map((r) => ({
      id: String(r.id ?? ''),
      fecha: String(r.fecha ?? ''),
      sucursal_id: Number(r.sucursal_id ?? 0),
      usuario_id: Number(r.usuario_id ?? 0),
      sucursales: r.sucursales ?? null,
      operadores: r.operadores ?? null,
      categoria_macro: null, // solo se completa cuando se filtra por categoría
    }));

  const enriched = await adjuntarResumenObservaciones(admin, items);
  return NextResponse.json({
    data: enriched,
  });
}

