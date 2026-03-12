import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/inventario/diferencias - lista diferencias no ajustadas para una sucursal y rango de fechas (solo admin) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sucursalIdParam = searchParams.get('sucursal_id');
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  const origen = searchParams.get('origen'); // 'Sucursal' | 'Auditoria' | null

  if (!sucursalIdParam || !desde || !hasta) {
    return NextResponse.json(
      { error: 'sucursal_id, desde y hasta son requeridos' },
      { status: 400 }
    );
  }

  const sucursalId = parseInt(sucursalIdParam, 10);
  if (Number.isNaN(sucursalId)) {
    return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const desdeIso = `${desde}T00:00:00.000Z`;
  const hastaIso = `${hasta}T23:59:59.999Z`;

  // Traer detalles de inventario con diferencias y que no estén ajustados
  let query = admin
    .from('controles_inventario_detalle')
    .select(
      'id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, controles_inventario!inner(fecha_inicio, sucursal_id, origen)'
    )
    .eq('controles_inventario.sucursal_id', sucursalId)
    .gte('controles_inventario.fecha_inicio', desdeIso)
    .lte('controles_inventario.fecha_inicio', hastaIso)
    .eq('con_diferencias', 1)
    .eq('ajustado', 0);

  if (origen === 'Sucursal' || origen === 'Auditoria') {
    query = query.eq('controles_inventario.origen', origen);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/** DELETE /api/inventario/diferencias?id=detalle_id - marcar una diferencia como descartada (no exportar) */
export async function DELETE(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const detalleId = searchParams.get('id');
  if (!detalleId) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // En lugar de borrar la fila, la marcamos como ajustada sin tocar el estado de negocio,
  // para que deje de aparecer en ajustes pero quede historial.
  const { error } = await admin
    .from('controles_inventario_detalle')
    .update({ ajustado: 1 })
    .eq('id', detalleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

