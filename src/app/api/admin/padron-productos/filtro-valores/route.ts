import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { listPadronValoresColumna, parsePadronFiltros } from '@/lib/padron-final-crud';
import { isPadronDatabaseConfigured } from '@/lib/padron-final-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/padron-productos/filtro-valores?columna=…
 * Valores distintos de una columna para el filtro tipo Excel del listado.
 * Acepta `q`, `searchColumn` y `filters` (los mismos del listado) y `buscar` para acotar.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronDatabaseConfigured()) {
    return NextResponse.json({ error: 'Base padron (abastecimiento) no configurada' }, { status: 503 });
  }

  const sp = request.nextUrl.searchParams;
  const columna = String(sp.get('columna') ?? '').trim();
  if (!columna) return NextResponse.json({ error: 'Falta la columna' }, { status: 400 });

  try {
    const result = await listPadronValoresColumna({
      columna,
      q: sp.get('q') ?? '',
      searchColumn: sp.get('searchColumn') || null,
      filtros: parsePadronFiltros(sp.get('filters')),
      buscar: sp.get('buscar') ?? '',
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al leer los valores de la columna';
    const status = msg.startsWith('Columna inexistente') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
