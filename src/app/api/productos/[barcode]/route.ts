import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
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
    .select('codplex, codebar, producto, presentaci, codlab, fraccionable')
    .eq('codebar', barcode)
    .maybeSingle();

  if (error) {
    console.error('Error buscando medicamento por código de barras:', error);
    return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
  }

  if (!med) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  // Resolver nombre de laboratorio (si existe en la tabla laboratorios)
  let laboratorioNombre: string | null = null;
  if (med.codlab != null) {
    const { data: lab, error: labError } = await admin
      .from('laboratorios')
      .select('laborato')
      .eq('codlab', med.codlab)
      .maybeSingle();

    if (labError) {
      console.error('Error buscando laboratorio para medicamento:', labError);
    }
    if (lab) {
      laboratorioNombre = lab.laborato;
    }
  }

  // Stock en tiempo real desde la base MySQL externa (Onze Center)
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  let stock_sistema = 0;
  let stock_cajas: number | undefined;
  let stock_unidades: number | undefined;
  let unidades_por_caja: number | undefined;

  if (sucursalId) {
    const sucursalNum = parseInt(sucursalId, 10);
    const idProducto = Number(med.codplex);
    if (!Number.isNaN(sucursalNum) && !Number.isNaN(idProducto)) {
      const { getStockFromLegacy } = await import('@/lib/legacy-db/mysql-stock');
      const stockRow = await getStockFromLegacy(sucursalNum, idProducto);

      if (stockRow) {
        const cajas = Number(stockRow.cantidad ?? 0);
        const unidadesSueltas = Number(stockRow.unidades ?? 0);
        const unidadesProd = Number(stockRow.unidadesprod ?? 0) || 1;

        stock_cajas = cajas;
        stock_unidades = unidadesSueltas;
        unidades_por_caja = unidadesProd;
        stock_sistema = cajas * unidadesProd + unidadesSueltas;
      }
    }
  }

  const producto = {
    producto_id_sistema: String(med.codplex),
    codigo_barras: med.codebar,
    descripcion: med.producto,
    presentacion: med.presentaci ?? null,
    laboratorio: laboratorioNombre ?? (med.codlab != null ? String(med.codlab) : null),
    stock_sistema,
    stock_cajas,
    stock_unidades,
    unidades_por_caja,
    fraccionable: med.fraccionable != null ? Number(med.fraccionable) : undefined,
  };

  return NextResponse.json({ data: producto });
}
