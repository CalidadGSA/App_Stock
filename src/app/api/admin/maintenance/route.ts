import { NextRequest, NextResponse } from 'next/server';
import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { getAppMaintenanceStatus } from '@/lib/maintenance';
import { isSuperAdminRole } from '@/lib/auth/roles';

const MAINTENANCE_ROW_ID = 1;

export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!isSuperAdminRole(operador.rol)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  try {
    const status = await getAppMaintenanceStatus();
    return NextResponse.json({ maintenance: status.isActive, updated_at: status.updatedAt });
  } catch (error) {
    console.error('Error consultando mantenimiento:', error);
    return NextResponse.json({ error: 'No se pudo consultar mantenimiento' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!isSuperAdminRole(operador.rol)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  let body: { is_active?: number } = {};
  try {
    body = (await request.json()) as { is_active?: number };
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (body.is_active !== 0 && body.is_active !== 1) {
    return NextResponse.json({ error: 'is_active debe ser 0 o 1' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from('modo_mantenimiento')
    .upsert(
      {
        id: MAINTENANCE_ROW_ID,
        is_active: body.is_active,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const status = await getAppMaintenanceStatus();
  return NextResponse.json({ maintenance: status.isActive, updated_at: status.updatedAt });
}
