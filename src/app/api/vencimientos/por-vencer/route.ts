import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPorVencerListPayload, parseVistaPorVencerList } from '@/lib/vencimientos-por-vencer-list';

/** GET /api/vencimientos/por-vencer — **solo sucursal actual** (cookie). Sin `consolidado`; para multi-sucursal usar `/api/vencimientos/por-vencer/consolidado`. */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get('consolidado') === '1') {
    return NextResponse.json(
      {
        error:
          'El listado consolidado usa /api/vencimientos/por-vencer/consolidado (sin verificación de ventas posteriores).',
      },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const checkVentaPosterior = searchParams.get('check_venta_posterior') === '1';
  const vista = parseVistaPorVencerList(searchParams.get('vista'));

  const admin = await createAdminClient();
  const result = await getPorVencerListPayload({
    admin,
    consolidado: false,
    sucursalCookie,
    sucursalFiltroNum: NaN,
    days,
    daysMin,
    catMacroFiltro: '',
    categoriaFiltro: '',
    vista,
    includeVentaPosteriorMysql: checkVentaPosterior,
    aplicarFiltrosPadronEnServidor: false,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}

/** DELETE /api/vencimientos/por-vencer?id=detalle_id
 * Elimina un registro de vencimiento (por venta u otra razón).
 */
export async function DELETE(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const cantidadParam = searchParams.get('cantidad');
  const cantidadVenta = cantidadParam ? parseInt(cantidadParam, 10) : null;
  if (cantidadParam && (!Number.isFinite(cantidadVenta) || (cantidadVenta ?? 0) <= 0)) {
    return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Verificar que el detalle pertenece a la sucursal actual (via join con control)
  const { data: row, error: rowError } = await admin
    .from('controles_vencimientos_detalle')
    .select('id, cantidad, eliminado, controles_vencimientos!inner(sucursal_id)')
    .eq('id', id)
    .maybeSingle();

  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

  const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
  if (String(sucursalRow) !== String(sucursalCookie)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  if (Number((row as any).eliminado ?? 0) === 1) {
    return NextResponse.json({ error: 'La línea fue eliminada' }, { status: 400 });
  }

  const cantidadActual = Number((row as any).cantidad ?? 0);
  if (!Number.isFinite(cantidadActual) || cantidadActual <= 0) {
    return NextResponse.json({ error: 'El registro no tiene cantidad disponible' }, { status: 400 });
  }

  const cantidadAplicar = cantidadVenta ?? cantidadActual;
  if (cantidadAplicar > cantidadActual) {
    return NextResponse.json(
      { error: `La cantidad a vender no puede ser mayor a ${cantidadActual}` },
      { status: 400 }
    );
  }

  const nuevoRestante = cantidadActual - cantidadAplicar;
  const payload =
    nuevoRestante <= 0
      ? { vendido: 1, cantidad: 0 }
      : { cantidad: nuevoRestante };

  const { error } = await admin
    .from('controles_vencimientos_detalle')
    .update(payload)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const restanteFinal = Math.max(0, nuevoRestante);
  const { error: ventaErr } = await admin.from('vencimientos_detalle_ventas').insert({
    detalle_id: id,
    cantidad_vendida: cantidadAplicar,
    cantidad_restante_despues: restanteFinal,
    linea_vendida_completa: restanteFinal <= 0 ? 1 : 0,
    usuario_id: operador.idoperador,
    sucursal_id: parseInt(sucursalCookie, 10),
  });
  if (ventaErr) {
    console.error('vencimientos_detalle_ventas insert:', ventaErr);
    return NextResponse.json(
      { error: `Actualizado el stock pero no se pudo registrar el historial de venta: ${ventaErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, cantidad_vendida: cantidadAplicar, cantidad_restante: restanteFinal });
}

/** PATCH /api/vencimientos/por-vencer - guarda acción/observación por línea */
export async function PATCH(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { id?: string; accion_observacion?: unknown }
    | null;
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const texto =
    typeof body?.accion_observacion === 'string'
      ? body.accion_observacion
      : String(body?.accion_observacion ?? '');
  const trimmed = texto.trim();

  const admin = await createAdminClient();
  const { data: row, error: rowError } = await admin
    .from('controles_vencimientos_detalle')
    .select('id, controles_vencimientos!inner(sucursal_id)')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });
  const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
  if (String(sucursalRow) !== String(sucursalCookie)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  const { error } = await admin
    .from('controles_vencimientos_detalle')
    .update({ accion_observacion: trimmed || null })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, accion_observacion: trimmed || null });
}
