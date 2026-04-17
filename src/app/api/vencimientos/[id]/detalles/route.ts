import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

interface VencimientoDetalleBody {
  producto_id_sistema: string;
  codigo_barras?: string | null;
  descripcion: string;
  presentacion?: string;
  laboratorio?: string;
  fecha_vencimiento: string;
  cantidad: number;
}

function normalizarFechaVencimiento(fechaInput: string): string | null {
  const raw = (fechaInput ?? '').trim();
  if (!raw) return null;

  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) return raw;

  const ymMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (!ymMatch) return null;
  const year = Number(ymMatch[1]);
  const month = Number(ymMatch[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(lastDay).padStart(2, '0');
  return `${year}-${monthStr}-${dayStr}`;
}

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
  const { data: control } = await admin
    .from('controles_vencimientos')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  if (String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Control cerrado' }, { status: 400 });

  const body = await request.json() as VencimientoDetalleBody;
  const fechaVencimientoNormalizada = normalizarFechaVencimiento(body.fecha_vencimiento);
  if (!fechaVencimientoNormalizada) {
    return NextResponse.json({ error: 'fecha_vencimiento inválida' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .insert({
      control_id: controlId,
      producto_id_sistema: body.producto_id_sistema,
      codigo_barras: body.codigo_barras ?? null,
      descripcion: body.descripcion,
      presentacion: body.presentacion ?? null,
      laboratorio: body.laboratorio ?? null,
      fecha_vencimiento: fechaVencimientoNormalizada,
      cantidad: body.cantidad,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from('controles_vencimientos').update({ updated_at: new Date().toISOString() }).eq('id', controlId);

  return NextResponse.json({ data }, { status: 201 });
}

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
    .from('controles_vencimientos')
    .select('estado, sucursal_id')
    .eq('id', controlId)
    .single();

  if (!control || String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Control cerrado' }, { status: 400 });

  const { error } = await admin.from('controles_vencimientos_detalle').delete().eq('id', detalleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
