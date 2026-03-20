import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import {
  inferirTipoControlInventario,
  nombreTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

type DetalleConDiferencia = {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sistema: number | null;
  stock_sist_cajas: number | null;
  stock_sist_unidades: number | null;
  estado?: string | null;
  auditado?: number | null;
  controles_inventario?: {
    fecha_inicio?: string | null;
  } | null;
  medicamentos?: {
    idpsicofarmaco?: string | null;
  } | null;
};

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
  const tipoObjetivo = 'auditoria';

  const { data: controlesAbiertos, error: abiertosError } = await admin
    .from('controles_inventario')
    .select('id, origen, tipo, categoria_macro, descripcion')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'en_progreso');

  if (abiertosError) {
    return NextResponse.json({ error: abiertosError.message }, { status: 500 });
  }

  const controlAbiertoMismoTipo = (controlesAbiertos ?? []).find(
    (control) => inferirTipoControlInventario(control) === tipoObjetivo
  );

  if (controlAbiertoMismoTipo) {
    return NextResponse.json(
      {
        error: `Ya hay una ${nombreTipoControlInventario(tipoObjetivo)} abierta.`,
      },
      { status: 409 }
    );
  }

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
      origen: 'Auditoria',
      tipo: 'auditoria',
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
    .select('id, tipo')
    .eq('sucursal_id', sucursalId)
    .eq('estado', 'cerrado');

  if (!cerradosError && controlesCerrados && controlesCerrados.length > 0) {
    const idsCerrados = controlesCerrados
      .filter((c) => c.tipo !== 'auditoria')
      .map((c) => c.id);

    if (idsCerrados.length > 0) {
      const { data: detallesConDif, error: difError } = await admin
        .from('controles_inventario_detalle')
        .select(
          'producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sistema, stock_sist_cajas, stock_sist_unidades, estado, auditado, controles_inventario!inner(fecha_inicio), medicamentos!left(idpsicofarmaco)'
        )
        .neq('diferencia', 0)
        .eq('auditado', 0)
        .neq('estado', 'ajustado_auditoria')
        .in('control_id', idsCerrados)
        .order('fecha_inicio', {
          foreignTable: 'controles_inventario',
          ascending: false,
        })
        .order('fecha_registro', { ascending: false });

      if (!difError && detallesConDif && detallesConDif.length > 0) {
        // Deduplicar por producto conservando la última vez que fue inventariado con diferencia.
        const porProducto = new Map<string, DetalleConDiferencia>();
        for (const detalle of detallesConDif as DetalleConDiferencia[]) {
          const productoId = detalle.producto_id_sistema;
          if (!productoId || porProducto.has(productoId)) continue;
          porProducto.set(productoId, detalle);
        }

        const productosUnicos = Array.from(porProducto.values());
        const psicotropicos = productosUnicos.filter(
          (d) => !!d.medicamentos?.idpsicofarmaco
        );
        const noPsicotropicos = productosUnicos.filter(
          (d) => !d.medicamentos?.idpsicofarmaco
        );

        const seleccionados = [
          ...psicotropicos.slice(0, 15),
          ...noPsicotropicos.slice(0, 35),
        ];

        // Para cada producto, usamos el último stock_sistema y desglose grabado en el control anterior
        const filasInsert = seleccionados.map((d) => ({
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
        }));

        if (filasInsert.length > 0) {
          await admin.from('controles_inventario_detalle').insert(filasInsert);
        }
      }
    }
  }

  return NextResponse.json({ data: control }, { status: 201 });
}

