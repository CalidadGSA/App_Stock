import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import {
  esTipoControlVisibleParaOperadorSucursal,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** GET /api/inventario/[id] - obtener un control con sus detalles */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  const esAdmin = operador.rol === 'admin';

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_inventario')
    .select(
      '*, sucursales(nombrefantasia), operadores(nombrecompleto), controles_inventario_detalle(*)'
    )
    .eq('id', id)
    .eq('sucursal_id', sucursalId ?? '')
    // Mantener el orden original de carga de los productos (por fecha_registro del detalle)
    .order('fecha_registro', {
      foreignTable: 'controles_inventario_detalle',
      ascending: true,
    })
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const tipoControl = inferirTipoControlInventario(data);
  if (!esAdmin && !esTipoControlVisibleParaOperadorSucursal(tipoControl)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  return NextResponse.json({ data });
}
