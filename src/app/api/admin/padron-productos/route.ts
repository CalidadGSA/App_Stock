import { requirePermission } from '@/lib/auth/rbac';
import { listPadron, parsePadronFiltros } from '@/lib/padron-final-crud';
import { isPadronDatabaseConfigured } from '@/lib/padron-final-db';
import { NextRequest, NextResponse } from 'next/server';

function padronUnavailable() {
  return NextResponse.json(
    {
      error:
        'Base padron (abastecimiento) no configurada. Definí PADRON_DB_URL o PADRON_DB_* en el entorno.',
    },
    { status: 503 }
  );
}

/** GET — listado paginado + metadatos de columnas */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '25', 10);
  const q = searchParams.get('q') ?? '';
  const searchColumn = searchParams.get('searchColumn') ?? searchParams.get('qCol') ?? '';
  const columnsParam = searchParams.get('columns');
  const columns = columnsParam
    ? columnsParam.split(',').map((c) => c.trim()).filter(Boolean)
    : undefined;
  const sortBy = searchParams.get('sortBy');
  const sortDirParam = searchParams.get('sortDir');
  const sortDir = sortDirParam === 'desc' ? 'desc' : 'asc';

  try {
    const result = await listPadron({
      page,
      pageSize,
      q,
      searchColumn: searchColumn || null,
      filtros: parsePadronFiltros(searchParams.get('filters')),
      columns,
      sortBy,
      sortDir,
    });
    return NextResponse.json({
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      columns: result.columns,
      meta: result.meta,
      sortBy: result.sortBy,
      sortDir: result.sortDir,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al listar padrón';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Sin POST: el alta de productos se hace solo en el ERP (Plex). `padron_final` se puebla
 * con el sync de plexdr, así que una fila creada acá quedaría fuera de esa fuente.
 * Next responde 405 a POST al no exportar el handler.
 */
