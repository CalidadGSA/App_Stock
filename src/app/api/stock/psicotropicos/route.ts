import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { getSucursalSession } from '@/lib/sucursales/sucursal-session';
import { esSesionDrogueria } from '@/lib/sucursales/sesion-drogueria';
import { listarPsicotropicosEnStock } from '@/lib/stock/psicotropicos-en-stock';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/psicotropicos
 * Psicotrópicos con existencia en la sucursal de la sesión, con los datos del encabezado
 * del listado imprimible (sucursal y operador).
 */
export async function GET() {
  const guard = await requirePermission('stock.psicotropicos');
  if (!guard.ok) return guard.response;

  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sucursal = await getSucursalSession();
  if (!sucursal) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const sucursalId = parseInt(sucursal.id, 10);
  if (Number.isNaN(sucursalId)) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 });
  }

  try {
    const admin = await createAdminClient();
    const [esDrogueria, { data: datosSucursal }] = await Promise.all([
      esSesionDrogueria(),
      admin
        .from('sucursales')
        .select('nombrefantasia, domicilio, telefono')
        .eq('sucursal', sucursalId)
        .maybeSingle(),
    ]);

    const productos = await listarPsicotropicosEnStock({ sucursalId, esDrogueria });

    return NextResponse.json({
      data: {
        sucursal: {
          nombre: String(datosSucursal?.nombrefantasia ?? sucursal.nombre ?? '').trim(),
          domicilio: String(datosSucursal?.domicilio ?? '').trim(),
          telefono: String(datosSucursal?.telefono ?? '').trim(),
        },
        operador: String(operador.nombrecompleto || operador.operador || '').trim(),
        generado_at: new Date().toISOString(),
        productos,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error al leer el stock de psicotrópicos';
    console.error('GET stock/psicotropicos:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
