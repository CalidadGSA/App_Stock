import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import { NextRequest, NextResponse } from 'next/server';
import { getPorVencerListPayload, parseSortKeyPorVencerList, parseVistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';
import { parsePaginationParams } from '@/lib/api/pagination';

/**
 * Listado por vencer **multi-sucursal** (solo admin / superadmin).
 * No incluye verificación MySQL de “venta posterior a la carga” (solo aplica en GET /api/vencimientos/por-vencer por sucursal).
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('vencimientos.consolidado');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const catMacroFiltro = String(searchParams.get('cat_macro') ?? '').trim();
  const categoriaFiltro = String(searchParams.get('categoria') ?? '').trim();
  const laboratorioFiltro = String(searchParams.get('laboratorio') ?? '').trim();
  const sucursalQueryRaw = searchParams.get('sucursal');
  const sucursalFiltroNum = sucursalQueryRaw != null && sucursalQueryRaw !== '' ? parseInt(sucursalQueryRaw, 10) : NaN;
  const vista = parseVistaPorVencerList(searchParams.get('vista'));
  const pagination = parsePaginationParams(searchParams);
  const mesVencRaw = parseInt(searchParams.get('mes_venc') ?? '', 10);
  const anioVencRaw = parseInt(searchParams.get('anio_venc') ?? '', 10);

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
    laboratorioFiltro,
    vista,
    includeVentaPosteriorMysql: false,
    page: pagination.page,
    pageSize: pagination.pageSize,
    unpaginated: pagination.unpaginated,
    busqueda: String(searchParams.get('busqueda') ?? '').trim(),
    mesVenc: Number.isFinite(mesVencRaw) && mesVencRaw > 0 ? mesVencRaw : undefined,
    anioVenc: Number.isFinite(anioVencRaw) && anioVencRaw > 0 ? anioVencRaw : undefined,
    sortBy: parseSortKeyPorVencerList(searchParams.get('sortBy')),
    sortDir: searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc',
    agruparFilas: false,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}
