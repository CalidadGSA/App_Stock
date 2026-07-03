import { getOperadorSession } from '@/lib/auth/session';
import {
  buscarProductosEnPadron,
  fichaPadronABusqueda,
  padronProductosDisponible,
} from '@/lib/padron-productos-lookup';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/productos/buscar?q=texto
// Busca en padron_final (abastecimiento) por nombre, presentación, código o troquel.
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!padronProductosDisponible()) {
    return NextResponse.json(
      { error: 'Base padrón (abastecimiento) no configurada' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';

  try {
    const resultados = (await buscarProductosEnPadron(q, 40)).map(fichaPadronABusqueda);
    return NextResponse.json({ data: resultados });
  } catch (e) {
    console.error('Error buscando productos en padron_final:', e);
    return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
  }
}
