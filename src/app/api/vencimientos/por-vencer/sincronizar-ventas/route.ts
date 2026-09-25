import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { sincronizarVentasAutoSucursal } from '@/lib/vencimientos/sincronizar-ventas-auto';
import { NextRequest, NextResponse } from 'next/server';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';

/**
 * POST /api/vencimientos/por-vencer/sincronizar-ventas
 * Desconectado de la UI (modo manual). Conservado para reactivar: docs/VENTAS_AUTO_POR_VENCER.md
 * `forzar=1` ignora el resultado reciente y vuelve a consultar la base legacy.
 */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sucursalCookie = await getSucursalIdSesion();
  if (!sucursalCookie) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }
  const sucursalId = parseInt(sucursalCookie, 10);
  if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 });
  }

  const forzar = new URL(request.url).searchParams.get('forzar') === '1';

  const admin = await createAdminClient();
  const resumen = await sincronizarVentasAutoSucursal({ admin, sucursalId, forzar });

  // Una base legacy caída no debe romper la vista: se responde 200 con el estado.
  return NextResponse.json(resumen);
}
