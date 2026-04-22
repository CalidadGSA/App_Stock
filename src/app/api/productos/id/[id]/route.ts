import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const allowMissingStock =
    request.nextUrl.searchParams.get('allow_missing_stock') === '1';

  const { id } = await params;
  const idProducto = Number(id);
  if (!Number.isFinite(idProducto)) {
    return NextResponse.json({ error: 'Id de producto inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data: med, error } = await admin
    .from('medicamentos')
    .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, fraccionable, refrigeracion, activo, visible')
    .eq('codplex', idProducto)
    .eq('activo', 'S')
    .eq('visible', 1)
    .neq('troquel', 0)
    .maybeSingle();

  if (error) {
    console.error('Error buscando medicamento por ID (codplex):', error);
    return NextResponse.json({ error: 'Error al buscar el producto' }, { status: 500 });
  }
  if (
    !med ||
    (med.activo as string | null)?.toUpperCase() !== 'S' ||
    Number((med as { visible?: number | null }).visible ?? 0) !== 1
  ) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  const troquelNum = Number((med as { troquel?: number | string | null }).troquel);
  if (!Number.isFinite(troquelNum) || troquelNum === 0) {
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
        const { getStockFromLegacyDetailed, legacyStockRaceToSistemaFields } = await import(
          '@/lib/legacy-db/mysql-stock'
        );

        const timeoutMs = 1500;
        const stockResult = await Promise.race([
          getStockFromLegacyDetailed(sucursalNum, idProducto),
          new Promise<{ status: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
          ),
        ]);

        const resolved = legacyStockRaceToSistemaFields(stockResult, allowMissingStock);
        if (resolved.ok) {
          stock_cajas = resolved.stock_cajas;
          stock_unidades = resolved.stock_unidades;
          unidades_por_caja = resolved.unidades_por_caja;
          stock_sistema = resolved.stock_sistema;
        } else {
          stockLookupFailed = true;
        }
      } catch (e) {
        console.error('Error obteniendo stock legacy para producto', med.codplex, e);
        stockLookupFailed = !allowMissingStock;
        if (allowMissingStock) {
          stock_cajas = 0;
          stock_unidades = 0;
          unidades_por_caja = 1;
          stock_sistema = 0;
        }
      }
    }
  }

  if (allowMissingStock && stock_sistema == null && !stockLookupFailed) {
    stock_cajas = 0;
    stock_unidades = 0;
    unidades_por_caja = 1;
    stock_sistema = 0;
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
    troquel:
      med.troquel != null && String(med.troquel).trim() !== ''
        ? Number(med.troquel) || med.troquel
        : null,
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

