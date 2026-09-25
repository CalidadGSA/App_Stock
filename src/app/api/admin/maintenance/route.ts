import { NextRequest, NextResponse } from 'next/server';
import { getAppMaintenanceStatus, setAppMaintenanceActive } from '@/lib/maintenance';
import { requirePermission } from '@/lib/auth/rbac';

export async function GET() {
  const guard = await requirePermission('admin.maintenance');
  if (!guard.ok) return guard.response;

  try {
    const status = await getAppMaintenanceStatus();
    return NextResponse.json({ maintenance: status.isActive, updated_at: status.updatedAt });
  } catch (error) {
    console.error('Error consultando mantenimiento:', error);
    return NextResponse.json({ error: 'No se pudo consultar mantenimiento' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission('admin.maintenance');
  if (!guard.ok) return guard.response;

  let body: { is_active?: number } = {};
  try {
    body = (await request.json()) as { is_active?: number };
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (body.is_active !== 0 && body.is_active !== 1) {
    return NextResponse.json({ error: 'is_active debe ser 0 o 1' }, { status: 400 });
  }

  const { error } = await setAppMaintenanceActive(body.is_active);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  const status = await getAppMaintenanceStatus({ fresh: true });
  return NextResponse.json({ maintenance: status.isActive, updated_at: status.updatedAt });
}
