import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

type ItemRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: string | null;
};

/** GET /api/vencimientos/vencidos
 * Lista productos vencidos en la sucursal actual según la lógica:
 * - FARMA / PSICOTROPICOS: entre fecha_vencimiento y fecha_vencimiento + 40 días (aprox últimos 40 días vencidos)
 * - BIENESTAR: entre fecha_vencimiento y fecha_vencimiento + 10 días
 * En la práctica: buscamos registros de los últimos 40 días y filtramos en memoria por categoría.
 */
export async function GET(_request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];
  const hace40 = new Date(hoy.getTime() - 40 * 86400000).toISOString().split('T')[0];

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select(
      'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, vendido, controles_vencimientos!inner(sucursal_id, categoria_macro)'
    )
    .eq('controles_vencimientos.sucursal_id', parseInt(sucursalId, 10))
    .gte('fecha_vencimiento', hace40)
    .lt('fecha_vencimiento', hoyStr)
    .eq('vendido', 0)
    .order('fecha_vencimiento', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  function diasDesde(fecha: string) {
    const d = new Date(fecha);
    const diffMs = hoy.getTime() - d.getTime();
    return Math.floor(diffMs / 86400000);
  }

  const items: ItemRow[] = rows
    .map((r) => {
      const cat = (r.controles_vencimientos?.categoria_macro as string | null) ?? null;
      const dias = diasDesde(r.fecha_vencimiento);
      let dentroVentana = false;
      if (cat === 'BIENESTAR') {
        dentroVentana = dias >= 0 && dias <= 10;
      } else {
        // FARMA / PSICOTROPICOS / otros
        dentroVentana = dias >= 0 && dias <= 40;
      }
      if (!dentroVentana) return null;
      return {
        id: r.id as string,
        control_id: r.control_id as string,
        producto_id_sistema: r.producto_id_sistema as string,
        codigo_barras: r.codigo_barras as string,
        descripcion: r.descripcion as string,
        presentacion: (r.presentacion as string | null) ?? null,
        laboratorio: (r.laboratorio as string | null) ?? null,
        fecha_vencimiento: r.fecha_vencimiento as string,
        cantidad: Number(r.cantidad ?? 0),
        categoria_macro: cat,
      };
    })
    .filter((x): x is ItemRow => x !== null);

  return NextResponse.json({
    data: items,
    hoy: hoyStr,
  });
}

/** PATCH /api/vencimientos/vencidos
 * - PATCH ?id=detalle_id        -> marca un registro como vendido
 * - PATCH ?devolver_todos=1     -> crea una devolución y marca como devueltos todos los ids recibidos en el body
 */
export async function PATCH(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const devolverTodos = searchParams.get('devolver_todos') === '1';

  const admin = await createAdminClient();

  if (id && !devolverTodos) {
    // Marcar un solo registro como vendido
    const { data: row, error: rowError } = await admin
      .from('controles_vencimientos_detalle')
      .select('id, controles_vencimientos!inner(sucursal_id)')
      .eq('id', id)
      .maybeSingle();

    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

    const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
    if (String(sucursalRow) !== String(sucursalId)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const { error } = await admin
      .from('controles_vencimientos_detalle')
      .update({ vendido: 1 })
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (devolverTodos) {
    const body = (await request.json().catch(() => null)) as { ids?: string[] } | null;
    const ids = Array.isArray(body?.ids) ? body!.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids requeridos para devolver_todos' }, { status: 400 });
    }

    // Verificar que todos los registros pertenezcan a la sucursal y obtener datos para la devolución
    const { data: detalles, error: detError } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, controles_vencimientos!inner(sucursal_id, categoria_macro)'
      )
      .in('id', ids);

    if (detError) {
      return NextResponse.json({ error: detError.message }, { status: 500 });
    }

    const rows = (detalles ?? []) as any[];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Registros no encontrados' }, { status: 404 });
    }

    for (const r of rows) {
      const sucursalRow = r.controles_vencimientos?.sucursal_id;
      if (String(sucursalRow) !== String(sucursalId)) {
        return NextResponse.json({ error: 'Sin acceso a uno o más registros' }, { status: 403 });
      }
    }

    // Crear cabecera de devolución
    const { data: cab, error: cabError } = await admin
      .from('devoluciones_vencimientos')
      .insert({
        sucursal_id: parseInt(sucursalId, 10),
        usuario_id: operador.idoperador,
      })
      .select()
      .single();

    if (cabError || !cab) {
      return NextResponse.json(
        { error: cabError?.message ?? 'Error al registrar la devolución' },
        { status: 500 }
      );
    }

    const devolucionId = cab.id as string;

    const detalleRows = rows.map((r) => ({
      devolucion_id: devolucionId,
      detalle_vencimiento_id: r.id as string,
      control_id: r.control_id as string,
      producto_id_sistema: r.producto_id_sistema as string,
      codigo_barras: r.codigo_barras as string,
      descripcion: r.descripcion as string,
      presentacion: (r.presentacion as string | null) ?? null,
      laboratorio: (r.laboratorio as string | null) ?? null,
      fecha_vencimiento: r.fecha_vencimiento as string,
      cantidad: Number(r.cantidad ?? 0),
      categoria_macro: (r.controles_vencimientos?.categoria_macro as string | null) ?? null,
    }));

    const { error: detInsError } = await admin
      .from('devoluciones_vencimientos_detalle')
      .insert(detalleRows);

    if (detInsError) {
      return NextResponse.json({ error: detInsError.message }, { status: 500 });
    }

    // Marcar como devuelto (vendido = 0, devuelto = 1)
    const { error: updError } = await admin
      .from('controles_vencimientos_detalle')
      .update({ vendido: 0, devuelto: 1 })
      .in('id', ids);

    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, devolucion_id: devolucionId });
  }

  return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
}

