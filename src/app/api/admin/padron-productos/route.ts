import { requirePermission } from '@/lib/auth/rbac';
import {
  createPadronRow,
  getPadronRow,
  listPadron,
} from '@/lib/padron-final-crud';
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
  const columnsParam = searchParams.get('columns');
  const columns = columnsParam
    ? columnsParam.split(',').map((c) => c.trim()).filter(Boolean)
    : undefined;
  const sortBy = searchParams.get('sortBy');
  const sortDirParam = searchParams.get('sortDir');
  const sortDir = sortDirParam === 'desc' ? 'desc' : 'asc';

  try {
    const result = await listPadron({ page, pageSize, q, columns, sortBy, sortDir });
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

/** POST — alta de registro */
export async function POST(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  try {
    const created = await createPadronRow(body);
    const row = await getPadronRow(created.pk);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al crear registro';
    const status = msg.includes('obligatorio') || msg.includes('Ya existe') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
