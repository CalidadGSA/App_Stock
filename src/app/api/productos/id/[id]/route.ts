import { getOperadorSession } from '@/lib/auth/session';
import {
  fichaPadronAProductoLegacy,
  getProductoPadronById,
  padronProductosDisponible,
  resolverStockLegacy,
} from '@/lib/padron-productos-lookup';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!padronProductosDisponible()) {
    return NextResponse.json(
      { error: 'Base padrón (abastecimiento) no configurada' },
      { status: 503 }
    );
  }

  const allowMissingStock =
    request.nextUrl.searchParams.get('allow_missing_stock') === '1';

  const { id } = await params;
  const idProducto = Number(id);
  if (!Number.isFinite(idProducto)) {
    return NextResponse.json({ error: 'Id de producto inválido' }, { status: 400 });
  }

  const ficha = await getProductoPadronById(id);
  if (!ficha) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;

  const stockRes = await resolverStockLegacy(
    sucursalId,
    ficha.producto_id_sistema,
    allowMissingStock
  );

  if (!stockRes.ok) {
    return NextResponse.json(
      {
        error:
          'No se pudo consultar el stock del sistema en este momento. Volvé a intentar para evitar contar con datos incorrectos.',
      },
      { status: 503 }
    );
  }

  const producto = fichaPadronAProductoLegacy(ficha, stockRes.stock);
  return NextResponse.json({ data: producto });
}
