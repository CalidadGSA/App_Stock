import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

interface DetalleBody {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion?: string;
  laboratorio?: string;
  stock_sistema: number;
  stock_real: number;
}

/** POST /api/inventario/[id]/detalles - agregar una línea al control */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: controlId } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

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
  if (control.sucursal_id !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'El control ya está cerrado' }, { status: 400 });

  const body = await request.json() as DetalleBody;

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
      stock_real: body.stock_real,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Actualizar updated_at del control
  await admin.from('controles_inventario').update({ updated_at: new Date().toISOString() }).eq('id', controlId);

  return NextResponse.json({ data }, { status: 201 });
}

/** DELETE /api/inventario/[id]/detalles?detalle_id=xxx - eliminar una línea */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: controlId } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

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

  if (!control || control.sucursal_id !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Control cerrado' }, { status: 400 });

  const { error } = await admin.from('controles_inventario_detalle').delete().eq('id', detalleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
