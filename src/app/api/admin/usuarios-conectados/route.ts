import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorRbacContext, isSuperAdminContext } from '@/lib/auth/rbac';
import { presenceOnlineSinceIso } from '@/lib/auth/presence';

/** GET /api/admin/usuarios-conectados — cantidad de operadores con presencia reciente (solo superadmin). */
export async function GET() {
  const ctx = await getOperadorRbacContext();
  if (!ctx) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (!isSuperAdminContext(ctx)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const admin = await createAdminClient();
  const since = presenceOnlineSinceIso();

  const { count, error } = await admin
    .from('operador_presencia')
    .select('idoperador', { count: 'exact', head: true })
    .gte('last_seen_at', since);

  if (error) {
    if (String(error.message ?? '').includes('operador_presencia')) {
      return NextResponse.json({
        conectados: 0,
        since,
        error: 'Falta migrar operador_presencia (022_operador_presencia.sql)',
      });
    }
    console.error('usuarios-conectados:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    conectados: count ?? 0,
    since,
  });
}
