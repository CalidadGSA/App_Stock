import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST { detalle_id, cantidad } — quita unidades por error de carga (no registra venta). */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  let body: { detalle_id?: string; cantidad?: number };
  try {
    body = (await request.json()) as { detalle_id?: string; cantidad?: number };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const detalleId = String(body.detalle_id ?? '').trim();
  const quitar = Number(body.cantidad);
  if (!detalleId || !Number.isFinite(quitar) || quitar <= 0) {
    return NextResponse.json({ error: 'detalle_id y cantidad válidos requeridos' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data: row, error: rowError } = await admin
    .from('controles_vencimientos_detalle')
    .select('id, control_id, cantidad, eliminado, controles_vencimientos!inner(sucursal_id)')
    .eq('id', detalleId)
    .maybeSingle();

  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

  const r = row as {
    cantidad?: number;
    eliminado?: number;
    controles_vencimientos?: { sucursal_id?: number };
  };
  const sucRow = r.controles_vencimientos?.sucursal_id;
  if (String(sucRow) !== String(sucursalCookie)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  if (Number(r.eliminado ?? 0) === 1) {
    return NextResponse.json({ error: 'La línea ya está eliminada' }, { status: 400 });
  }

  const actual = Number(r.cantidad ?? 0);
  if (!Number.isFinite(actual) || actual <= 0) {
    return NextResponse.json({ error: 'Sin cantidad para reducir' }, { status: 400 });
  }
  if (quitar > actual) {
    return NextResponse.json(
      { error: `No podés quitar más de ${actual} unidades` },
      { status: 400 }
    );
  }

  const nuevo = actual - quitar;
  const payload =
    nuevo <= 0 ? { cantidad: 0, eliminado: 1 } : { cantidad: nuevo };

  const { error: upErr } = await admin.from('controles_vencimientos_detalle').update(payload).eq('id', detalleId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const controlId = String((row as { control_id?: string }).control_id ?? '');
  if (controlId) {
    await admin
      .from('controles_vencimientos')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', controlId);
  }

  return NextResponse.json({
    ok: true,
    cantidad_restante: Math.max(0, nuevo),
    eliminado: nuevo <= 0 ? 1 : 0,
  });
}
