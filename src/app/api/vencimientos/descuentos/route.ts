import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';

type DescuentoRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  categoria_macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  subrubro_id: number | null;
  descuento: number;
};

export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];
  const en90 = new Date(hoy.getTime() + 90 * 86400000).toISOString().split('T')[0];

  // Meta para exportación (nombre archivo)
  const sucSucursalId = parseInt(sucursalId, 10);
  const { data: sucursalRow } = await admin
    .from('sucursales')
    .select('nombrefantasia')
    .eq('sucursal', sucSucursalId)
    .maybeSingle();

  const mesNombre = hoy.toLocaleString('es-ES', { month: 'long' });
  const anio = hoy.getFullYear();
  const sucursalNombre = sucursalRow?.nombrefantasia ?? `Sucursal ${sucursalId}`;

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select(
      'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, vendido, devuelto, controles_vencimientos!inner(sucursal_id, categoria_macro)'
    )
    .eq('controles_vencimientos.sucursal_id', parseInt(sucursalId, 10))
    .gte('fecha_vencimiento', hoyStr)
    .lte('fecha_vencimiento', en90)
    .eq('vendido', 0)
    .eq('devuelto', 0)
    .order('fecha_vencimiento', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  // Obtener subrubro por producto_id_sistema desde medicamentos
  const productoIds = Array.from(
    new Set(
      rows
        .map((r) => r.producto_id_sistema as string | null)
        .filter((v): v is string => !!v)
    )
  );

  const { data: meds, error: medsError } = await admin
    .from('medicamentos')
    .select('codplex, idsubrubro')
    .in(
      'codplex',
      productoIds.map((id) => Number(id))
    );

  if (medsError) {
    return NextResponse.json({ error: medsError.message }, { status: 500 });
  }

  const subrubroPorProducto = new Map<number, number | null>();
  for (const m of meds ?? []) {
    const cod = (m as any).codplex as number;
    const sub = (m as any).idsubrubro as number | null;
    subrubroPorProducto.set(cod, sub ?? null);
  }
  const resultado: DescuentoRow[] = [];

  for (const r of rows) {
    const cat = (r.controles_vencimientos?.categoria_macro as
      | 'FARMA'
      | 'BIENESTAR'
      | 'PSICOTROPICOS'
      | null) ?? null;
    const prodId = Number(r.producto_id_sistema ?? 0);
    const subId = subrubroPorProducto.get(prodId) ?? null;

    const fechaV = new Date(r.fecha_vencimiento as string);
    const diffMs = fechaV.getTime() - hoy.getTime();
    const diasHasta = Math.floor(diffMs / 86400000);

    // Buscar regla de descuento según subrubro y días hasta vencimiento
    const reglasQuery = admin
      .from('descuentos_vencimientos_reglas')
      .select('id, id_subrubro, categoria_macro, dias_min, dias_max, descuento')
      .eq('activo', 1)
      .lte('dias_min', diasHasta)
      .gte('dias_max', diasHasta);

    // Si hay subrubro, priorizar reglas específicas; si no, usar reglas generales (id_subrubro nulo)
    if (subId != null) {
      reglasQuery.eq('id_subrubro', subId);
    } else {
      reglasQuery.is('id_subrubro', null);
    }

    const { data: reglas, error: reglasError } = await reglasQuery.limit(1);
    if (reglasError || !reglas || reglas.length === 0) {
      continue;
    }

    const regla = reglas[0] as { descuento: number };
    const descuento = Number(regla.descuento ?? 0);
    if (descuento <= 0) continue;

    resultado.push({
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
      subrubro_id: subId,
      descuento,
    });
  }

  return NextResponse.json({
    data: resultado,
    meta: {
      sucursal_nombre: sucursalNombre,
      mes: mesNombre,
      anio,
    },
  });
}

