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
};

function parseFechaISOaUTC(fecha: string): number {
  const [y, m, d] = String(fecha).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

/** GET /api/vencimientos/por-vencer?days=30&cod_rubro=123
 * Lista productos por vencer en la sucursal actual, ordenados por fecha_vencimiento ASC.
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const codRubroParam = searchParams.get('cod_rubro');
  const codRubro = codRubroParam ? parseInt(codRubroParam, 10) : null;

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];
  const hoyMid = parseFechaISOaUTC(hoyStr);
  const hasta = new Date(hoy.getTime() + days * 86400000).toISOString().split('T')[0];

  const admin = await createAdminClient();

  // Traer detalles del rango, filtrando por sucursal mediante join al control
  const { data: detalles, error } = await admin
    .from('controles_vencimientos_detalle')
    .select(
      'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, vendido, controles_vencimientos!inner(sucursal_id)'
    )
    .eq('controles_vencimientos.sucursal_id', parseInt(sucursalId, 10))
    .gte('fecha_vencimiento', hoyStr)
    .lte('fecha_vencimiento', hasta)
    .eq('vendido', 0)
    .order('fecha_vencimiento', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (detalles ?? []) as any[];
  const rowsDentroRango = rows.filter((r) => {
    const fechaV = parseFechaISOaUTC(String(r.fecha_vencimiento));
    if (!Number.isFinite(fechaV)) return false;
    const dias = Math.floor((fechaV - hoyMid) / 86400000);
    return dias >= daysMin;
  });

  const items: ItemRow[] = rowsDentroRango.map((r) => ({
    id: r.id,
    control_id: r.control_id,
    producto_id_sistema: r.producto_id_sistema,
    codigo_barras: r.codigo_barras,
    descripcion: r.descripcion,
    presentacion: r.presentacion ?? null,
    laboratorio: r.laboratorio ?? null,
    fecha_vencimiento: r.fecha_vencimiento,
    cantidad: Number(r.cantidad ?? 0),
  }));

  // Enriquecer con rubro (categoría) desde medicamentos.cod_rubro y rubros.Rubro
  const ids = Array.from(new Set(items.map((i) => Number(i.producto_id_sistema)).filter((n) => !Number.isNaN(n))));
  const medMap = new Map<number, number>();
  if (ids.length > 0) {
    const { data: meds } = await admin
      .from('medicamentos')
      .select('codplex, cod_rubro')
      .in('codplex', ids);
    (meds ?? []).forEach((m: any) => {
      const id = Number(m.codplex);
      const cr = Number(m.cod_rubro);
      if (!Number.isNaN(id) && !Number.isNaN(cr)) medMap.set(id, cr);
    });
  }

  const rubrosNecesarios = Array.from(new Set(Array.from(medMap.values())));
  const rubroNombreMap = new Map<number, string>();
  if (rubrosNecesarios.length > 0) {
    const { data: rubros } = await admin
      .from('rubros')
      .select('codrubro, rubro')
      .in('codrubro', rubrosNecesarios);
    (rubros ?? []).forEach((r: any) => {
      rubroNombreMap.set(Number(r.codrubro), (r.rubro as string | null) ?? String(r.codrubro));
    });
  }

  const enriquecidos = items.map((i) => {
    const cod = medMap.get(Number(i.producto_id_sistema)) ?? null;
    return {
      ...i,
      cod_rubro: cod,
      categoria: cod != null ? rubroNombreMap.get(cod) ?? String(cod) : null,
    };
  }).filter((i) => (codRubro != null ? i.cod_rubro === codRubro : true));

  const categorias = Array.from(
    new Map(
      enriquecidos
        .filter((i) => i.cod_rubro != null)
        .map((i) => [String(i.cod_rubro), { cod_rubro: i.cod_rubro as number, nombre: i.categoria as string }])
    ).values()
  ).sort((a, b) => a.nombre.localeCompare(b.nombre));

  return NextResponse.json({
    data: enriquecidos,
    categorias,
    days,
    daysMin,
    desde: hoyStr,
    hasta,
  });
}

/** DELETE /api/vencimientos/por-vencer?id=detalle_id
 * Elimina un registro de vencimiento (por venta u otra razón).
 */
export async function DELETE(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

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

  return NextResponse.json({ ok: true, cantidad_vendida: cantidadAplicar, cantidad_restante: Math.max(0, nuevoRestante) });
}

