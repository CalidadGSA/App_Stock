import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { ajustarCantidadVendidaDetalle } from '@/lib/vencimientos/ajustar-cantidad-vendida';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST { detalle_id, cantidad_vendida_total } — corrige unidades vendidas registradas por error. */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  let body: { detalle_id?: string; cantidad_vendida_total?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const detalleId = String(body.detalle_id ?? '').trim();
  if (!detalleId) {
    return NextResponse.json({ error: 'detalle_id requerido' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const result = await ajustarCantidadVendidaDetalle({
    admin,
    detalleId,
    sucursalId: parseInt(sucursalCookie, 10),
    usuarioId: operador.idoperador,
    cantidadVendidaTotal: Number(body.cantidad_vendida_total),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    cantidad_vendida_total: result.cantidad_vendida_total,
    cantidad_restante: result.cantidad_restante,
    vendido: result.vendido,
    cantidad_linea: result.cantidad_linea,
  });
}
