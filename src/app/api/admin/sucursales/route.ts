import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requireAnyPermission } from '@/lib/auth/rbac';
import { filtroSucursalesExcluidasLogin } from '@/lib/sucursales/login-sucursales';
import { NextResponse } from 'next/server';

/** GET /api/admin/sucursales — sucursales visibles (mismas exclusiones que login). */
export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requireAnyPermission([
    'admin.ajustes',
    'admin.ajustes_historial',
    'admin.resumen_trimestral',
    'admin.diferencias_psico',
    'admin.roles_manage',
  ]);
  if (!guard.ok) return guard.response;

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .eq('activa', true)
    .not('sucursal', 'in', filtroSucursalesExcluidasLogin())
    .order('nombrefantasia');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list =
    data?.map((r: { sucursal: number; nombrefantasia: string }) => ({
      id: String(r.sucursal),
      nombre: r.nombrefantasia,
    })) ?? [];

  return NextResponse.json({ data: list });
}

