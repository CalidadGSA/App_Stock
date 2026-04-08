import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  const { id: devolucionId } = await context.params;
  const admin = await createAdminClient();

  // Verificamos que la devolución pertenezca a la sucursal actual
  const { data: cab, error: cabError } = await admin
    .from('devoluciones_vencimientos')
    .select('id, fecha, sucursal_id, usuario_id, sucursales(nombrefantasia), operadores(nombrecompleto)')
    .eq('id', devolucionId)
    .maybeSingle();

  if (cabError) {
    return NextResponse.json({ error: cabError.message }, { status: 500 });
  }
  if (!cab) {
    return NextResponse.json({ error: 'Devolución no encontrada' }, { status: 404 });
  }

  if (String((cab as any).sucursal_id) !== String(sucursalId)) {
    return NextResponse.json({ error: 'Sin acceso a esta devolución' }, { status: 403 });
  }

  const { data: detalles, error: detError } = await admin
    .from('devoluciones_vencimientos_detalle')
    .select(
      'id, devolucion_id, detalle_vencimiento_id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, categoria_macro, accion_observacion'
    )
    .eq('devolucion_id', devolucionId)
    .order('fecha_vencimiento', { ascending: true });

  if (detError) {
    return NextResponse.json({ error: detError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      cabecera: cab,
      detalles: detalles ?? [],
    },
  });
}

