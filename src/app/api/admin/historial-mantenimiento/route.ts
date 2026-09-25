import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorRbacContext, isSuperAdminContext } from '@/lib/auth/rbac';
import { fechaHoyArgentinaYmd, rangoFechasArgentinaIso } from '@/lib/utils';

export type HistorialMantenimientoRow = {
  id: string;
  origen: string | null;
  notas: string | null;
  inicio_at: string;
  fin_at: string | null;
};

/** GET /api/admin/historial-mantenimiento — problemas del día (solo superadmin). */
export async function GET() {
  const ctx = await getOperadorRbacContext();
  if (!ctx) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (!isSuperAdminContext(ctx)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const hoy = fechaHoyArgentinaYmd();
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(hoy, hoy);
  const admin = await createAdminClient();

  const { data, error } = await admin
    .from('historial_modo_mantenimiento')
    .select('id, origen, notas, inicio_at, fin_at')
    .gte('inicio_at', desdeIso)
    .lte('inicio_at', hastaIso)
    .order('inicio_at', { ascending: false });

  if (error) {
    console.error('historial-mantenimiento:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fecha: hoy,
    data: (data ?? []) as HistorialMantenimientoRow[],
  });
}
