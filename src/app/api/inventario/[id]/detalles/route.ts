import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

interface DetalleBody {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion?: string;
  laboratorio?: string;
  stock_sistema: number;
  /** Stock de sistema desglosado, si el frontend lo conoce */
  stock_sist_cajas?: number;
  stock_sist_unidades?: number;
  /** Cantidad contada en cajas (opcional) */
  stock_real_cajas?: number;
  /** Cantidad contada en unidades sueltas (opcional) */
  stock_real_unidades?: number;
  /** Total contado en unidades (si el frontend lo calculó) */
  stock_real: number;
}

/** POST /api/inventario/[id]/detalles - agregar una línea al control */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const admin = await createAdminClient();

  // Verificar que el control pertenece a la sucursal y está en progreso
  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  if (String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'El control ya está cerrado' }, { status: 400 });

  const body = await request.json() as DetalleBody;

  const cajas =
    typeof body.stock_real_cajas === 'number' && !Number.isNaN(body.stock_real_cajas)
      ? body.stock_real_cajas
      : null;
  const unidadesSueltas =
    typeof body.stock_real_unidades === 'number' && !Number.isNaN(body.stock_real_unidades)
      ? body.stock_real_unidades
      : null;

  const { data, error } = await admin
    .from('controles_inventario_detalle')
    .insert({
      control_id: controlId,
      producto_id_sistema: body.producto_id_sistema,
      codigo_barras: body.codigo_barras,
      descripcion: body.descripcion,
      presentacion: body.presentacion ?? null,
      laboratorio: body.laboratorio ?? null,
      stock_sistema: body.stock_sistema,
      stock_sist_cajas:
        typeof body.stock_sist_cajas === 'number' && !Number.isNaN(body.stock_sist_cajas)
          ? body.stock_sist_cajas
          : null,
      stock_sist_unidades:
        typeof body.stock_sist_unidades === 'number' && !Number.isNaN(body.stock_sist_unidades)
          ? body.stock_sist_unidades
          : null,
      stock_real_cajas: cajas,
      stock_real_unidades: unidadesSueltas,
      stock_real: body.stock_real,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Actualizar updated_at del control
  await admin.from('controles_inventario').update({ updated_at: new Date().toISOString() }).eq('id', controlId);

  return NextResponse.json({ data }, { status: 201 });
}

/** PATCH /api/inventario/[id]/detalles - actualizar una línea existente (revisión de diferencias) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const admin = await createAdminClient();

  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  if (String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'El control ya está cerrado' }, { status: 400 });

  const body = await request.json() as {
    detalle_id: string;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
    stock_real: number;
  };

  if (!body.detalle_id) {
    return NextResponse.json({ error: 'detalle_id requerido' }, { status: 400 });
  }

  const cajas =
    typeof body.stock_real_cajas === 'number' && !Number.isNaN(body.stock_real_cajas)
      ? body.stock_real_cajas
      : null;
  const unidadesSueltas =
    typeof body.stock_real_unidades === 'number' && !Number.isNaN(body.stock_real_unidades)
      ? body.stock_real_unidades
      : null;

  const { data, error } = await admin
    .from('controles_inventario_detalle')
    .update({
      stock_real_cajas: cajas,
      stock_real_unidades: unidadesSueltas,
      stock_real: body.stock_real,
    })
    .eq('id', body.detalle_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Actualizar updated_at del control
  await admin.from('controles_inventario').update({ updated_at: new Date().toISOString() }).eq('id', controlId);

  return NextResponse.json({ data });
}

/** DELETE /api/inventario/[id]/detalles?detalle_id=xxx - eliminar una línea */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const detalleId = new URL(request.url).searchParams.get('detalle_id');
  if (!detalleId) return NextResponse.json({ error: 'detalle_id requerido' }, { status: 400 });

  const admin = await createAdminClient();
  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control || String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Control cerrado' }, { status: 400 });

  const { error } = await admin.from('controles_inventario_detalle').delete().eq('id', detalleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
