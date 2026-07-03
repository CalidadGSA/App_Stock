import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { cargarDiferenciasResumenPeriodo } from '@/lib/inventario/diferencias-resumen-carga';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { parsePaginationParams } from '@/lib/api/pagination';

export type { DiferenciaResumenFila } from '@/lib/inventario/diferencias-resumen-carga';

function parseMesAnioParam(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseOrigen(v: string | null): 'sucursal' | 'auditoria' | 'todos' {
  const o = String(v ?? '').trim().toLowerCase();
  if (o === 'auditoria' || o === 'todos') return o;
  return 'sucursal';
}

/** GET /api/inventario/diferencias-resumen — diferencias de controles de sucursal (sin auditoría). */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requirePermission('inventario.diferencias_resumen');
  if (!guard.ok) return guard.response;

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }
  const sucursalNum = parseInt(sucursalId, 10);
  if (Number.isNaN(sucursalNum)) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const desdeActual = searchParams.get('desdeActual');
  const hastaActual = searchParams.get('hastaActual');
  const categoriaMacro = searchParams.get('categoria_macro');
  const busqueda =
    String(searchParams.get('busqueda') ?? searchParams.get('codigo_barras') ?? '').trim();

  if (!desdeActual || !hastaActual) {
    return NextResponse.json(
      { error: 'desdeActual y hastaActual son requeridos' },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();
  const pagination = parsePaginationParams(searchParams);

  try {
    const resumen = await cargarDiferenciasResumenPeriodo(admin, {
      sucursalId: sucursalNum,
      desde: desdeActual,
      hasta: hastaActual,
      filtroOrigen: parseOrigen(searchParams.get('origen')),
      tipoControl: searchParams.get('tipo') ?? undefined,
      busqueda,
      categoriaMacro: categoriaMacro ?? undefined,
      mesControl: parseMesAnioParam(searchParams.get('mes')),
      anioControl: parseMesAnioParam(searchParams.get('anio')),
      operador: searchParams.get('operador') ?? undefined,
      page: pagination.page,
      pageSize: pagination.pageSize,
      unpaginated: pagination.unpaginated,
    });

    return NextResponse.json({
      data: resumen.data,
      total: resumen.total,
      page: resumen.page,
      pageSize: resumen.pageSize,
      cat_macros: resumen.cat_macros,
      operadores: resumen.operadores,
      desdeActual,
      hastaActual,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al calcular diferencias';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
