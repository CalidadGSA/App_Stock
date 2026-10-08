import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';
import { detectarVentasPosteriores } from '@/lib/vencimientos/ventas-posteriores';

export const dynamic = 'force-dynamic';

/** Tope por pedido: la pantalla manda solo las líneas visibles. */
const MAX_IDS = 500;

/**
 * POST /api/vencimientos/por-vencer/ventas-posteriores
 * Body: { detalle_ids: string[], sucursal_id?: number }
 *
 * Indica cuáles de esas líneas tuvieron ventas facturadas después del día en que se cargaron.
 * Es informativo: no modifica cantidades ni marca nada como vendido.
 */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: { detalle_ids?: unknown; sucursal_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const detalleIds = Array.isArray(body.detalle_ids)
    ? body.detalle_ids.map((x) => String(x)).filter(Boolean).slice(0, MAX_IDS)
    : [];

  if (detalleIds.length === 0) {
    return NextResponse.json({ ok: true, por_detalle: {}, consultados: 0 });
  }

  // La sucursal sale de la sesión; el parámetro solo se acepta en la vista consolidada.
  const sucursalCookie = await getSucursalIdSesion();
  const sucursalParam = Number(body.sucursal_id);
  const sucursalId = Number.isFinite(sucursalParam) && sucursalParam > 0
    ? sucursalParam
    : parseInt(String(sucursalCookie ?? ''), 10);

  if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const res = await detectarVentasPosteriores(admin, sucursalId, detalleIds);

  // Si la base legacy no responde, la pantalla sigue funcionando sin los badges.
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error, por_detalle: {} });
  }

  return NextResponse.json({
    ok: true,
    por_detalle: res.porDetalle,
    consultados: res.consultados,
  });
}
