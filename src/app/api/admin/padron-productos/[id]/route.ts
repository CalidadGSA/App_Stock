import { requirePermission } from '@/lib/auth/rbac';
import {
  deletePadronRow,
  getPadronRow,
  updatePadronRow,
} from '@/lib/padron-final-crud';
import { isPadronDatabaseConfigured } from '@/lib/padron-final-db';
import { NextRequest, NextResponse } from 'next/server';

function padronUnavailable() {
  return NextResponse.json(
    { error: 'Base padron (abastecimiento) no configurada' },
    { status: 503 }
  );
}

/** GET — registro completo (todas las columnas) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;
  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  const { id } = await params;
  try {
    const row = await getPadronRow(decodeURIComponent(id));
    return NextResponse.json({ data: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar registro';
    const status = msg.includes('no encontrado') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** PATCH — actualizar campos enviados */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;
  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  try {
    await updatePadronRow(decodeURIComponent(id), body);
    const row = await getPadronRow(decodeURIComponent(id));
    return NextResponse.json({ data: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al actualizar';
    const status =
      msg.includes('no encontrado') || msg.includes('No hay campos') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** DELETE */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;
  if (!isPadronDatabaseConfigured()) return padronUnavailable();

  const { id } = await params;
  try {
    await deletePadronRow(decodeURIComponent(id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al eliminar';
    const status = msg.includes('no encontrado') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
