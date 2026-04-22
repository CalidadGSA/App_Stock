import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { isAdminLikeRole } from '@/lib/auth/roles';
import { NextRequest, NextResponse } from 'next/server';
import { getPorVencerListPayload, parseVistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';

/**
 * Listado por vencer **multi-sucursal** (solo admin / superadmin).
 * No incluye verificación MySQL de “venta posterior a la carga” (solo aplica en GET /api/vencimientos/por-vencer por sucursal).
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!isAdminLikeRole(operador.rol)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const catMacroFiltro = String(searchParams.get('cat_macro') ?? '').trim();
  const categoriaFiltro = String(searchParams.get('categoria') ?? '').trim();
  const sucursalQueryRaw = searchParams.get('sucursal');
  const sucursalFiltroNum = sucursalQueryRaw != null && sucursalQueryRaw !== '' ? parseInt(sucursalQueryRaw, 10) : NaN;
  const vista = parseVistaPorVencerList(searchParams.get('vista'));

  const admin = await createAdminClient();
  const result = await getPorVencerListPayload({
    admin,
    consolidado: true,
    sucursalCookie: null,
    sucursalFiltroNum,
    days,
    daysMin,
    catMacroFiltro,
    categoriaFiltro,
    vista,
    includeVentaPosteriorMysql: false,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}
