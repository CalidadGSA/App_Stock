import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST /api/inventario/auditoria - crear auditoría de inventario (solo admin) */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  let body: { descripcion?: string } = {};
  try {
    body = (await request.json()) as { descripcion?: string };
  } catch {
    // Ignoramos errores de parseo; descripción será opcional
  }

  const descripcion =
    body.descripcion && body.descripcion.trim().length > 0
      ? body.descripcion.trim()
      : 'Auditoría de inventario';

  // Crear el control de auditoría
  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      descripcion,
    })
    .select()
    .single();

  if (createError || !control) {
    return NextResponse.json(
      { error: createError?.message ?? 'Error al crear auditoría' },
      { status: 500 }
    );
  }

  const controlId = control.id as string;

  // Traer productos con diferencias en controles cerrados de esta sucursal
  const { data: controlesCerrados, error: cerradosError } = await admin
    .from('controles_inventario')
    .select('id')
    .eq('sucursal_id', sucursalId)
    .eq('estado', 'cerrado');

  if (!cerradosError && controlesCerrados && controlesCerrados.length > 0) {
    const idsCerrados = controlesCerrados.map((c) => c.id);

    const { data: detallesConDif, error: difError } = await admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sistema, stock_sist_cajas, stock_sist_unidades'
      )
      .neq('diferencia', 0)
      .in('control_id', idsCerrados);

    if (!difError && detallesConDif && detallesConDif.length > 0) {
    // Agrupar por producto + código de barras para no duplicar demasiadas filas
    const clave = (d: any) => `${d.producto_id_sistema}::${d.codigo_barras}`;
    const mapa = new Map<string, any>();
    for (const d of detallesConDif) {
      const k = clave(d);
      if (!mapa.has(k)) mapa.set(k, d);
    }
    const productosUnicos = Array.from(mapa.values());

      // Para cada producto, usamos el último stock_sistema y desglose grabado en el control anterior
      const filasInsert: any[] = [];
      for (const d of productosUnicos) {
        filasInsert.push({
          control_id: controlId,
          producto_id_sistema: d.producto_id_sistema,
          codigo_barras: d.codigo_barras,
          descripcion: d.descripcion,
          presentacion: d.presentacion ?? null,
          laboratorio: d.laboratorio ?? null,
          stock_sistema: d.stock_sistema ?? 0,
          stock_sist_cajas: d.stock_sist_cajas ?? null,
          stock_sist_unidades: d.stock_sist_unidades ?? null,
          stock_real_cajas: null,
          stock_real_unidades: null,
          stock_real: 0,
        });
      }

      if (filasInsert.length > 0) {
        await admin.from('controles_inventario_detalle').insert(filasInsert);
      }
    }
  }

  return NextResponse.json({ data: control }, { status: 201 });
}

