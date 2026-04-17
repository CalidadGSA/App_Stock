import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Versión básica de búsqueda de producto por código de barras:
// NO consulta stock en MySQL, solo ficha desde medicamentos + laboratorio.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { barcode } = await params;

  const admin = await createAdminClient();

  // Resolver primero el ID de producto desde productoscodebars (para evitar duplicados por codebar)
  let idProductoFromBarcode: number | null = null;
  const { data: mapRow, error: mapError } = await admin
    .from('productoscodebars')
    .select('idproducto')
    .eq('codebar', barcode)
    .order('idproducto', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mapError) {
    console.error('Error buscando mapping productoscodebars por código de barras (básico):', mapError);
  }
  if (mapRow && typeof mapRow.idproducto === 'number') {
    idProductoFromBarcode = mapRow.idproducto;
  }

  // Buscar en medicamentos por ID (codplex) si lo conocemos; si no, caer a buscar por codebar pero limitando a 1 fila
  let med: any = null;
  if (idProductoFromBarcode != null) {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, producto, presentaci, codlab, refrigeracion, activo')
      .eq('codplex', idProductoFromBarcode)
      .maybeSingle();

    if (error) {
      console.error('Error buscando medicamento por ID (codplex) [básico]:', error);
      return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
    }
    med = data;
  } else {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, producto, presentaci, codlab, refrigeracion, activo')
      .eq('codebar', barcode)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error buscando medicamento por código de barras [básico]:', error);
      return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
    }
    med = data;

    if (!med) {
      const { data: byAltCodebar, error: altErr } = await admin
        .from('medicamentos')
        .select('codplex, troquel, codebar, producto, presentaci, codlab, refrigeracion, activo')
        .or(`codebar2.eq.${barcode},codebar3.eq.${barcode},codebar4.eq.${barcode}`)
        .limit(1)
        .maybeSingle();
      if (altErr) {
        console.error('Error buscando medicamento por codebar alternativo [básico]:', altErr);
        return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
      }
      med = byAltCodebar;
    }

    if (!med) {
      const { data: byTroquel, error: troqErr } = await admin
        .from('medicamentos')
        .select('codplex, troquel, codebar, producto, presentaci, codlab, refrigeracion, activo')
        .eq('troquel', barcode)
        .limit(1)
        .maybeSingle();
      if (troqErr) {
        console.error('Error buscando medicamento por troquel [básico]:', troqErr);
        return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
      }
      med = byTroquel;
    }
  }

  if (!med || (med.activo as string | null)?.toUpperCase() !== 'S') {
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
      console.error('Error buscando laboratorio para medicamento [básico]:', labError);
    }
    if (lab) {
      laboratorioNombre = lab.laborato;
    }
  }

  const producto = {
    producto_id_sistema: String(med.codplex),
    codigo_barras: med.codebar,
    codigos_secundarios: [] as string[],
    descripcion: med.producto,
    presentacion: med.presentaci ?? null,
    laboratorio: laboratorioNombre ?? (med.codlab != null ? String(med.codlab) : null),
    stock_sistema: 0,
    stock_cajas: undefined,
    stock_unidades: undefined,
    unidades_por_caja: undefined,
    fraccionable: undefined,
    refrigerado: String(med.refrigeracion ?? '').toUpperCase() === 'S',
  };

  return NextResponse.json({ data: producto });
}

