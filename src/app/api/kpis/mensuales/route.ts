import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getOperadorRbacContext,
  isSuperAdminContext,
  type OperadorRbacContext,
} from '@/lib/auth/rbac';
import { isAdminLikeRole } from '@/lib/auth/roles';
import { getSucursalSession } from '@/lib/sucursales/sucursal-session';
import { esSucursalDrogueria } from '@/lib/sucursales/drogueria';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import { cargarKpisMensualesSucursal } from '@/lib/kpis/kpis-mensuales';
import { calendarioActualArgentina, clampYmNoFuturo } from '@/lib/vencimientos-mes-anio-filtro';
import { parseYm } from '@/lib/utils';

/** Solo admin / superadmin (rol enum o rol de app) pueden ver KPIs de otra sucursal. */
function puedeElegirSucursal(ctx: OperadorRbacContext): boolean {
  return (
    isSuperAdminContext(ctx) ||
    isAdminLikeRole(ctx.operador.rol) ||
    ctx.appRoleCodigo === 'admin'
  );
}

/**
 * GET /api/kpis/mensuales?mes=YYYY-MM[&sucursal_id=N]
 * KPIs mensuales de la sucursal en la que está logueado el usuario. `sucursal_id` solo para
 * admin/superadmin; para el resto se ignora y se responde con la sucursal de la sesión.
 */
export async function GET(request: NextRequest) {
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sucursalSesion = await getSucursalSession();
  if (!sucursalSesion) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const mesRaw = String(searchParams.get('mes') ?? '').trim();
  const ym = mesRaw ? clampYmNoFuturo(mesRaw) : calendarioActualArgentina().ym;
  if (!parseYm(ym)) return NextResponse.json({ error: 'mes inválido (YYYY-MM)' }, { status: 400 });

  const admin = await createAdminClient();

  let sucursalId = parseInt(sucursalSesion.id, 10);
  let esDrogueria = sucursalSesion.esDrogueria;
  let sucursalNombre = sucursalSesion.nombre;

  const esAdmin = puedeElegirSucursal(rbac);
  const sucursalParam = String(searchParams.get('sucursal_id') ?? '').trim();
  if (esAdmin && sucursalParam && sucursalParam !== sucursalSesion.id) {
    const n = parseInt(sucursalParam, 10);
    if (!Number.isFinite(n) || !esSucursalVisibleEnLogin(n)) {
      return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
    }
    const { data: suc } = await admin
      .from('sucursales')
      .select('sucursal, nombrefantasia')
      .eq('sucursal', n)
      .maybeSingle();
    if (!suc) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
    sucursalId = n;
    sucursalNombre = String((suc as { nombrefantasia?: string }).nombrefantasia ?? n);
    esDrogueria = await esSucursalDrogueria(admin, n);
  }

  if (!Number.isFinite(sucursalId)) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 });
  }

  const res = await cargarKpisMensualesSucursal(admin, { sucursalId, ym, esDrogueria });
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 400 });

  return NextResponse.json({
    data: {
      ...res,
      sucursal_nombre: sucursalNombre,
      puede_elegir_sucursal: esAdmin,
      sucursal_sesion: { id: sucursalSesion.id, nombre: sucursalSesion.nombre },
    },
  });
}
