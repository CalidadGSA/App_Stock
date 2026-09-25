import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { rangoUtcAjustesInventario } from '@/lib/inventario/ajustes-query-fecha';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/inventario/diferencias - lista diferencias no ajustadas para una sucursal y rango de fechas (solo admin) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requirePermission('admin.ajustes');
  if (!guard.ok) return guard.response;

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

  const { desdeIso, hastaIso } = rangoUtcAjustesInventario(desde, hasta);

  // Por fecha de cierre del control (controles cerrados tarde no reaparecen en días ya ajustados).
  let query = admin
    .from('controles_inventario_detalle')
    .select(
      'id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, fecha_registro, controles_inventario!inner(fecha_inicio, fecha_fin, sucursal_id, origen, estado)'
    )
    .eq('controles_inventario.sucursal_id', sucursalId)
    .eq('controles_inventario.estado', 'cerrado')
    .not('controles_inventario.fecha_fin', 'is', null)
    .gte('controles_inventario.fecha_fin', desdeIso)
    .lte('controles_inventario.fecha_fin', hastaIso)
    .eq('con_diferencias', 1)
    .eq('ajustado', 0);

  if (origen === 'Sucursal' || origen === 'Auditoria') {
    query = query.eq('controles_inventario.origen', origen);
  }

  const { data, error } = await query
    .order('fecha_registro', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    fecha_registro?: string | null;
    controles_inventario?:
      | { fecha_fin?: string | null }
      | { fecha_fin?: string | null }[]
      | null;
  };

  const rows = [...((data as Row[]) ?? [])].sort((a, b) => {
    const ctrlA = Array.isArray(a.controles_inventario)
      ? a.controles_inventario[0]
      : a.controles_inventario;
    const ctrlB = Array.isArray(b.controles_inventario)
      ? b.controles_inventario[0]
      : b.controles_inventario;
    const ta = Date.parse(String(a.fecha_registro ?? ctrlA?.fecha_fin ?? '')) || 0;
    const tb = Date.parse(String(b.fecha_registro ?? ctrlB?.fecha_fin ?? '')) || 0;
    return tb - ta;
  });

  return NextResponse.json({ data: rows });
}

/** DELETE /api/inventario/diferencias?id=detalle_id - marcar una diferencia como descartada (no exportar) */
export async function DELETE(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requirePermission('admin.ajustes');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const detalleId = searchParams.get('id');
  if (!detalleId) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // En lugar de borrar la fila, la marcamos como ajustada (para que deje de aparecer en
  // ajustes) y con estado 'descartado' para dejar registro de que no fue realmente
  // exportada/corregida (no debe habilitar la línea para una futura auditoría).
  const { error } = await admin
    .from('controles_inventario_detalle')
    .update({ ajustado: 1, estado: 'descartado' })
    .eq('id', detalleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

