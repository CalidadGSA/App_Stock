import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';

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
  accion_observacion: string | null;
  cantidad_vendida_acumulada: number;
  cantidad_cargada_original: number;
  /** Vendidos / carga original (0–1). */
  ratio_vendido_sobre_original: number | null;
  /** Si hace falta texto para poder devolver (vendido &lt; 50 % de la carga original). */
  obligatorio_observacion_devolucion: boolean;
};

function enriquecerItem(
  base: Omit<
    ItemRow,
    | 'accion_observacion'
    | 'cantidad_vendida_acumulada'
    | 'cantidad_cargada_original'
    | 'ratio_vendido_sobre_original'
    | 'obligatorio_observacion_devolucion'
  > & { accion_observacion: string | null },
  ventasMap: Map<string, number>
): ItemRow {
  const vend = ventasMap.get(base.id) ?? 0;
  const rest = Number(base.cantidad) || 0;
  const orig = rest + vend;
  const ratio = orig > 0 ? Math.min(1, vend / orig) : null;
  const obs = String(base.accion_observacion ?? '').trim();
  const bajo50 = orig > 0 && vend * 2 < orig;
  return {
    ...base,
    accion_observacion: base.accion_observacion,
    cantidad_vendida_acumulada: vend,
    cantidad_cargada_original: orig,
    ratio_vendido_sobre_original: ratio,
    obligatorio_observacion_devolucion: bajo50 && !obs,
  };
}

/** GET /api/vencimientos/vencidos
 * Lista productos vencidos en la sucursal actual según la lógica:
 * - FARMA / PSICOTROPICOS: entre fecha_vencimiento y fecha_vencimiento + 40 días (aprox últimos 40 días vencidos)
 * - BIENESTAR: entre fecha_vencimiento y fecha_vencimiento + 10 días
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
      'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, vendido, devuelto, accion_observacion, controles_vencimientos!inner(sucursal_id, categoria_macro)'
    )
    .eq('controles_vencimientos.sucursal_id', parseInt(sucursalId, 10))
    .gte('fecha_vencimiento', hace40)
    .lt('fecha_vencimiento', hoyStr)
    .eq('vendido', 0)
    .eq('devuelto', 0)
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

  const prelim: Array<
    Omit<
      ItemRow,
      | 'cantidad_vendida_acumulada'
      | 'cantidad_cargada_original'
      | 'ratio_vendido_sobre_original'
      | 'obligatorio_observacion_devolucion'
    > & { accion_observacion: string | null }
  > = [];

  for (const r of rows) {
    const cat = (r.controles_vencimientos?.categoria_macro as string | null) ?? null;
    const dias = diasDesde(r.fecha_vencimiento);
    let dentroVentana = false;
    if (cat === 'BIENESTAR') {
      dentroVentana = dias >= 0 && dias <= 10;
    } else {
      dentroVentana = dias >= 0 && dias <= 40;
    }
    if (!dentroVentana) continue;
    prelim.push({
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
      accion_observacion:
        r.accion_observacion != null && String(r.accion_observacion).trim() !== ''
          ? String(r.accion_observacion)
          : null,
    });
  }

  const ventasMap = await sumarCantidadVendidaPorDetalle(
    admin,
    prelim.map((p) => p.id)
  );

  const items: ItemRow[] = prelim.map((p) =>
    enriquecerItem(
      {
        ...p,
        accion_observacion: p.accion_observacion,
      },
      ventasMap
    )
  );

  return NextResponse.json({
    data: items,
    hoy: hoyStr,
  });
}

/** PATCH /api/vencimientos/vencidos
 * - Body `{ id, accion_observacion }` → guarda observación
 * - `?id=&cantidad=` → marca venta (registra en vencimientos_detalle_ventas)
 * - `?devolver_todos=1` + body `{ ids }` → devolución (exige observación si vendido &lt; 50 % de la carga original)
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
  const cantidadParam = searchParams.get('cantidad');
  const cantidadVenta = cantidadParam ? parseInt(cantidadParam, 10) : null;
  if (cantidadParam && (!Number.isFinite(cantidadVenta) || (cantidadVenta ?? 0) <= 0)) {
    return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });
  }

  const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const admin = await createAdminClient();

  if (devolverTodos) {
    const ids = Array.isArray(rawBody?.ids) ? (rawBody!.ids as string[]) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids requeridos para devolver_todos' }, { status: 400 });
    }

    const { data: detalles, error: detError } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, accion_observacion, controles_vencimientos!inner(sucursal_id, categoria_macro)'
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

    const ventasMap = await sumarCantidadVendidaPorDetalle(
      admin,
      rows.map((r) => String(r.id))
    );

    const sinObs: string[] = [];
    for (const r of rows) {
      const rid = String(r.id);
      const rest = Number(r.cantidad ?? 0);
      const vend = ventasMap.get(rid) ?? 0;
      const orig = rest + vend;
      const obs = String(r.accion_observacion ?? '').trim();
      if (orig > 0 && vend * 2 < orig && !obs) {
        sinObs.push(String(r.descripcion ?? rid).slice(0, 120));
      }
    }

    if (sinObs.length > 0) {
      return NextResponse.json(
        {
          error:
            'Hay productos con menos del 50 % vendido sobre la carga original sin observación. Completá la columna de acción/observación antes de devolver.',
          productos_sin_observacion: sinObs,
        },
        { status: 400 }
      );
    }

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
      accion_observacion: (() => {
        const t = String(r.accion_observacion ?? '').trim();
        return t ? t : null;
      })(),
    }));

    const { error: detInsError } = await admin.from('devoluciones_vencimientos_detalle').insert(detalleRows);

    if (detInsError) {
      return NextResponse.json({ error: detInsError.message }, { status: 500 });
    }

    const { error: updError } = await admin
      .from('controles_vencimientos_detalle')
      .update({ vendido: 0, devuelto: 1 })
      .in('id', ids);

    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, devolucion_id: devolucionId });
  }

  if (
    rawBody &&
    typeof rawBody === 'object' &&
    rawBody.id != null &&
    Object.prototype.hasOwnProperty.call(rawBody, 'accion_observacion')
  ) {
    const bid = String(rawBody.id);
    const texto =
      typeof rawBody.accion_observacion === 'string' ? rawBody.accion_observacion : String(rawBody.accion_observacion ?? '');

    const { data: row, error: rowError } = await admin
      .from('controles_vencimientos_detalle')
      .select('id, controles_vencimientos!inner(sucursal_id)')
      .eq('id', bid)
      .maybeSingle();

    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

    const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
    if (String(sucursalRow) !== String(sucursalId)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const trimmed = texto.trim();
    const { error: upErr } = await admin
      .from('controles_vencimientos_detalle')
      .update({ accion_observacion: trimmed || null })
      .eq('id', bid);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, accion_observacion: trimmed || null });
  }

  if (id && !devolverTodos) {
    const { data: row, error: rowError } = await admin
      .from('controles_vencimientos_detalle')
      .select('id, cantidad, controles_vencimientos!inner(sucursal_id)')
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
      nuevoRestante <= 0 ? { vendido: 1, cantidad: 0 } : { cantidad: nuevoRestante };

    const { error } = await admin.from('controles_vencimientos_detalle').update(payload).eq('id', id);
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
      sucursal_id: parseInt(sucursalId, 10),
    });
    if (ventaErr) {
      console.error('vencimientos_detalle_ventas insert (vencidos):', ventaErr);
      return NextResponse.json(
        {
          error: `Actualizado el stock pero no se pudo registrar el historial de venta: ${ventaErr.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      cantidad_vendida: cantidadAplicar,
      cantidad_restante: restanteFinal,
    });
  }

  return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
}
