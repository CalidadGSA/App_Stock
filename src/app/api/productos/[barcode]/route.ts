import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { barcode } = await params;

  const admin = await createAdminClient();

  // Buscar primero en la tabla sincronizada de medicamentos (Supabase)
  const { data: med, error } = await admin
    .from('medicamentos')
    .select('codplex, codebar, producto, presentaci, codlab')
    .eq('codebar', barcode)
    .maybeSingle();

  if (error) {
    console.error('Error buscando medicamento por código de barras:', error);
    return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
  }

  if (!med) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const producto = {
    producto_id_sistema: String(med.codplex),
    codigo_barras: med.codebar,
    descripcion: med.producto,
    presentacion: med.presentaci ?? null,
    laboratorio: med.codlab != null ? String(med.codlab) : null,
    stock_sistema: 0,
  };

  return NextResponse.json({ data: producto });
}
