import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import { syncSucursalesFromLegacy } from '@/lib/legacy-db/syncLegacy';

export async function POST() {
  const guard = await requirePermission('admin.sync');
  if (!guard.ok) return guard.response;

  try {
    const result = await syncSucursalesFromLegacy();
    return NextResponse.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

