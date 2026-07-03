import { requirePermission } from '@/lib/auth/rbac';
import { getPadronMeta, listPadronForExport } from '@/lib/padron-final-crud';
import { isPadronDatabaseConfigured } from '@/lib/padron-final-db';
import { buildPadronExcelBuffer, padronExportFileName } from '@/lib/padron-export-excel';
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

/** GET — exportar padrón a Excel (.xlsx) */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const columnsParam = searchParams.get('columns');
  const sortBy = searchParams.get('sortBy');
  const sortDirParam = searchParams.get('sortDir');
  const sortDir = sortDirParam === 'desc' ? 'desc' : 'asc';
  const scope = searchParams.get('scope') ?? 'visible';

  try {
    const meta = await getPadronMeta();
    const columnNames =
      scope === 'all'
        ? meta.columns.map((c) => c.name)
        : columnsParam?.trim()
          ? columnsParam
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean)
          : meta.listDefaults.includes(meta.primaryKey)
            ? meta.listDefaults
            : [meta.primaryKey, ...meta.listDefaults];

    const result = await listPadronForExport({
      q,
      columns: columnNames,
      sortBy,
      sortDir,
    });

    if (result.exported === 0) {
      return NextResponse.json(
        { error: 'No hay registros para exportar con los filtros actuales.' },
        { status: 400 }
      );
    }

    const buffer = buildPadronExcelBuffer(result.data, columnNames, result.meta);
    const filename = padronExportFileName();

    const headers = new Headers({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Padron-Export-Total': String(result.total),
      'X-Padron-Export-Rows': String(result.exported),
      'X-Padron-Export-Truncated': result.truncated ? '1' : '0',
    });

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al exportar padrón';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
