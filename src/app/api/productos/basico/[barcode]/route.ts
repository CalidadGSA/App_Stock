import { getOperadorSession } from '@/lib/auth/session';
import {
  fichaPadronAProductoLegacy,
  getProductoPadronByBarcode,
  getProductoPadronById,
  padronProductosDisponible,
} from '@/lib/padron-productos-lookup';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Versión básica: solo ficha desde padron_final (sin stock MySQL).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!padronProductosDisponible()) {
    return NextResponse.json(
      { error: 'Base padrón (abastecimiento) no configurada' },
      { status: 503 }
    );
  }

  const { barcode } = await params;

  let ficha = await getProductoPadronByBarcode(barcode);

  if (!ficha) {
    const admin = await createAdminClient();
    const { data: mapRow } = await admin
      .from('productoscodebars')
      .select('idproducto')
      .eq('codebar', barcode)
      .order('idproducto', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (mapRow && typeof mapRow.idproducto === 'number') {
      ficha = await getProductoPadronById(mapRow.idproducto);
    }
  }

  if (!ficha) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const producto = fichaPadronAProductoLegacy(ficha, {
    stock_sistema: 0,
    stock_cajas: 0,
    stock_unidades: 0,
    unidades_por_caja: 1,
  });

  return NextResponse.json({ data: producto });
}
