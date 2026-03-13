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
    console.error('Error buscando mapping productoscodebars por código de barras:', mapError);
  }
  if (mapRow && typeof mapRow.idproducto === 'number') {
    idProductoFromBarcode = mapRow.idproducto;
  }

  // Buscar en medicamentos por ID (codplex) si lo conocemos; si no, caer a buscar por codebar pero limitando a 1 fila
  let med: any = null;
  if (idProductoFromBarcode != null) {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, fraccionable')
      .eq('codplex', idProductoFromBarcode)
      .maybeSingle();

    if (error) {
      console.error('Error buscando medicamento por ID (codplex):', error);
      return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
    }
    med = data;
  } else {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, fraccionable')
      .eq('codebar', barcode)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error buscando medicamento por código de barras:', error);
      return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
    }
    med = data;
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

  let stock_sistema: number | undefined;
  let stock_cajas: number | undefined;
  let stock_unidades: number | undefined;
  let unidades_por_caja: number | undefined;
  let stockLookupFailed = false;

  if (sucursalId) {
    const sucursalNum = parseInt(sucursalId, 10);
    const idProducto = Number(med.codplex);
    if (!Number.isNaN(sucursalNum) && !Number.isNaN(idProducto)) {
      try {
        const { getStockFromLegacyDetailed } = await import('@/lib/legacy-db/mysql-stock');

        // Evitar que la primera conexión lenta a MySQL bloquee toda la respuesta.
        const timeoutMs = 1500;
        const stockResult = await Promise.race([
          getStockFromLegacyDetailed(sucursalNum, idProducto),
          new Promise<{ status: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
          ),
        ]);

        if (stockResult.status === 'ok' && stockResult.row) {
          const stockRow = stockResult.row;
          const cajas = Number(stockRow.cantidad ?? 0);
          const unidadesSueltas = Number(stockRow.unidades ?? 0);
          const unidadesProd = Number(stockRow.unidadesprod ?? 0) || 1;

          stock_cajas = cajas;
          stock_unidades = unidadesSueltas;
          unidades_por_caja = unidadesProd;
          stock_sistema = cajas * unidadesProd + unidadesSueltas;
        } else if (stockResult.status !== 'ok') {
          stockLookupFailed = true;
        }
      } catch (e) {
        console.error('Error obteniendo stock legacy para producto', med.codplex, e);
        stockLookupFailed = true;
      }
    }
  }

  if (stockLookupFailed || stock_sistema == null) {
    return NextResponse.json(
      {
        error:
          'No se pudo consultar el stock del sistema en este momento. Volvé a intentar para evitar contar con datos incorrectos.',
      },
      { status: 503 }
    );
  }

  const producto = {
    producto_id_sistema: String(med.codplex),
    codigo_barras: med.codebar,
    codigos_secundarios: [med.codebar2, med.codebar3, med.codebar4]
      .filter((code: unknown): code is string => typeof code === 'string' && code.trim().length > 0)
      .filter((code, index, arr) => code !== med.codebar && arr.indexOf(code) === index),
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
