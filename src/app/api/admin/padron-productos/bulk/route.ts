import { requirePermission } from '@/lib/auth/rbac';
import { bulkUpdatePadron, type BulkUpdatePadronParams } from '@/lib/padron-final-crud';
import { isPadronDatabaseConfigured } from '@/lib/padron-final-db';
import { NextRequest, NextResponse } from 'next/server';

type BulkBody = {
  valores?: Record<string, unknown>;
  pks?: unknown;
  q?: string;
  searchColumn?: string | null;
};

/**
 * POST — modifica una o varias columnas editables en muchos productos a la vez.
 * Alcance: los `pks` enviados, o el resultado de la búsqueda (`q` + `searchColumn`).
 * Las columnas sincronizadas desde plexdr / onze_center se rechazan.
 */
export async function POST(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Base padron (abastecimiento) no configurada' },
      { status: 503 }
    );
  }

  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const valores =
    body.valores && typeof body.valores === 'object' && !Array.isArray(body.valores)
      ? body.valores
      : null;
  if (!valores || Object.keys(valores).length === 0) {
    return NextResponse.json(
      { error: 'Elegí al menos una columna y su nuevo valor' },
      { status: 400 }
    );
  }

  const pks = Array.isArray(body.pks)
    ? body.pks.map((v) => String(v ?? '').trim()).filter(Boolean)
    : [];

  const params: BulkUpdatePadronParams = {
    valores,
    pks,
    filtro: { q: String(body.q ?? ''), searchColumn: body.searchColumn ?? null },
  };

  try {
    const res = await bulkUpdatePadron(params);
    // Traza de auditoría: quién cambió qué y sobre cuántos productos.
    console.info('[padron bulk]', {
      operador: guard.ctx.operador.operador,
      idoperador: guard.ctx.operador.idoperador,
      columnas: res.columnas,
      alcance: res.alcance,
      actualizados: res.actualizados,
      modo: pks.length > 0 ? `seleccion(${pks.length})` : `busqueda(${body.searchColumn || 'amplia'}:${body.q ?? ''})`,
    });
    return NextResponse.json(res);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al modificar productos';
    const esValidacion =
      msg.includes('no se editan desde la app') ||
      msg.includes('Elegí al menos') ||
      msg.includes('Indicá productos');
    return NextResponse.json({ error: msg }, { status: esValidacion ? 400 : 500 });
  }
}
