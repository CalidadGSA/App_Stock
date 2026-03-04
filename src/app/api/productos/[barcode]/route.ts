import { createClient } from '@/lib/supabase/server';
import { buscarProductoPorBarras } from '@/lib/legacy-db/productos';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const { barcode } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const codigoSucursal = cookieStore.get('sucursal_codigo')?.value ?? '';

  // 1. Buscar en base legacy (o mock)
  let producto = await buscarProductoPorBarras(barcode, codigoSucursal);

  // 2. Si no se encontró en legacy, buscar en caché local
  if (!producto) {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const admin = await createAdminClient();
    const { data: cache } = await admin
      .from('productos_cache')
      .select('*')
      .eq('codigo_barras', barcode)
      .maybeSingle();

    if (cache) {
      producto = {
        producto_id_sistema: cache.producto_id_sistema,
        codigo_barras: cache.codigo_barras,
        descripcion: cache.descripcion,
        presentacion: cache.presentacion,
        laboratorio: cache.laboratorio,
        stock_sistema: 0,
      };
    }
  }

  if (!producto) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ data: producto });
}
