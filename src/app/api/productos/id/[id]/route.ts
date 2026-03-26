import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const idProducto = Number(id);
  if (!Number.isFinite(idProducto)) {
    return NextResponse.json({ error: 'Id de producto inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data: med, error } = await admin
    .from('medicamentos')
    .select('codplex, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, fraccionable, refrigeracion, activo')
    .eq('codplex', idProducto)
    .maybeSingle();

  if (error) {
    console.error('Error buscando medicamento por ID (codplex):', error);
    return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
  }
  if (!med || (med.activo as string | null)?.toUpperCase() === 'N') {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

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

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  let stock_sistema: number | undefined;
  let stock_cajas: number | undefined;
  let stock_unidades: number | undefined;
  let unidades_por_caja: number | undefined;
  let stockLookupFailed = false;

  if (sucursalId) {
    const sucursalNum = parseInt(sucursalId, 10);
    if (!Number.isNaN(sucursalNum)) {
      try {
        const { getStockFromLegacyDetailed } = await import('@/lib/legacy-db/mysql-stock');

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
    refrigerado: String(med.refrigeracion ?? '').toUpperCase() === 'S',
  };

  return NextResponse.json({ data: producto });
}

