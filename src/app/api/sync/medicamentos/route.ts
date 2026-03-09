import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { syncMedicamentosFromLegacy } from '@/lib/legacy-db/syncLegacy';

export async function POST() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

  try {
    const result = await syncMedicamentosFromLegacy();
    return NextResponse.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

