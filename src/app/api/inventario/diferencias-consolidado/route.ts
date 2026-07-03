import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import {
  cargarDiferenciasResumenPeriodo,
  type DiferenciaResumenFila,
} from '@/lib/inventario/diferencias-resumen-carga';
import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { parsePaginationParams } from '@/lib/api/pagination';

export type { DiferenciaResumenFila };

function parseMesAnioParam(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseOrigen(v: string | null): 'todos' | 'sucursal' | 'auditoria' {
  const o = String(v ?? '').trim().toLowerCase();
  if (o === 'sucursal' || o === 'auditoria') return o;
  return 'todos';
}

function rangoDesdeHastaPorPeriodo(days: number, daysMin: number): { desde: string; hasta: string } {
  const hoy = fechaHoyArgentinaYmd();
  if (days >= 365 && daysMin <= 0) {
    return { desde: ymdAddDays(hoy, -365), hasta: hoy };
  }
  return { desde: ymdAddDays(hoy, -Math.max(days, 1)), hasta: ymdAddDays(hoy, days) };
}

/** GET /api/inventario/diferencias-consolidado — diferencias multi-sucursal (admin). */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('inventario.diferencias_consolidado');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '90', 10) || 90, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const { desde, hasta } = rangoDesdeHastaPorPeriodo(days, daysMin);

  const sucursalRaw = searchParams.get('sucursal');
  const sucursalFiltro =
    sucursalRaw != null && sucursalRaw !== '' ? parseInt(sucursalRaw, 10) : undefined;

  const admin = await createAdminClient();
  const pagination = parsePaginationParams(searchParams);

  try {
    const resumen = await cargarDiferenciasResumenPeriodo(admin, {
      consolidado: true,
      sucursalFiltro:
        sucursalFiltro != null && Number.isFinite(sucursalFiltro) && sucursalFiltro > 0
          ? sucursalFiltro
          : undefined,
      desde,
      hasta,
      filtroOrigen: parseOrigen(searchParams.get('origen')),
      tipoControl: searchParams.get('tipo') ?? undefined,
      busqueda: String(searchParams.get('busqueda') ?? '').trim() || undefined,
      categoriaMacro: searchParams.get('categoria_macro') ?? undefined,
      mesControl: parseMesAnioParam(searchParams.get('mes')),
      anioControl: parseMesAnioParam(searchParams.get('anio')),
      page: pagination.page,
      pageSize: pagination.pageSize,
      unpaginated: pagination.unpaginated,
    });

    const sucursalesMap = new Map<number, string>();
    for (const row of resumen.data) {
      if (row.sucursal_id != null && row.sucursal_nombre) {
        sucursalesMap.set(row.sucursal_id, row.sucursal_nombre);
      }
    }
    const sucursales = Array.from(sucursalesMap.entries())
      .map(([sucursal, nombrefantasia]) => ({ sucursal, nombrefantasia }))
      .sort((a, b) => a.nombrefantasia.localeCompare(b.nombrefantasia, 'es'));

    return NextResponse.json({
      data: resumen.data,
      total: resumen.total,
      page: resumen.page,
      pageSize: resumen.pageSize,
      desde,
      hasta,
      days,
      daysMin,
      sucursales,
      cat_macros: resumen.cat_macros,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar diferencias';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
