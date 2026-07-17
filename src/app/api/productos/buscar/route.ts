import { getOperadorSession } from '@/lib/auth/session';
import {
  buscarProductosEnPadron,
  fichaPadronABusqueda,
  padronProductosDisponible,
} from '@/lib/padron-productos-lookup';
import {
  buscarProductosQuantio,
  fichaQuantioABusqueda,
  quantioProductosDisponible,
} from '@/lib/quantio-productos-lookup';
import { createAdminClient } from '@/lib/supabase/server';
import { esSesionDrogueria } from '@/lib/sucursales/sesion-drogueria';
import {
  enriquecerFichaConUbicacionDrogueria,
} from '@/lib/inventario/base-productos-drogueria';
import { formatearUbicacionDrogueria } from '@/lib/inventario/ubicacion-drogueria';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/productos/buscar?q=texto
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const admin = await createAdminClient();
  const esDrogueria = await esSesionDrogueria();

  try {
    if (esDrogueria) {
      if (!(await quantioProductosDisponible(admin))) {
        return NextResponse.json(
          { error: 'Catálogo Quantio (droguería) no configurado' },
          { status: 503 }
        );
      }
      const fichas = await buscarProductosQuantio(admin, q, 40);
      const enriquecidas = await Promise.all(
        fichas.map((f) => enriquecerFichaConUbicacionDrogueria(admin, f))
      );
      const resultados = enriquecidas.map((f) => ({
        ...fichaQuantioABusqueda(f),
        sector: f.sector ?? null,
        modulo: f.modulo ?? null,
        fila: f.fila ?? null,
        posicion: f.posicion ?? null,
        ubicacion: formatearUbicacionDrogueria({
          sector: f.sector ?? null,
          modulo: f.modulo ?? null,
          fila: f.fila ?? null,
          posicion: f.posicion ?? null,
        }),
      }));
      return NextResponse.json({ data: resultados });
    }

    if (!padronProductosDisponible()) {
      return NextResponse.json(
        { error: 'Base padrón (abastecimiento) no configurada' },
        { status: 503 }
      );
    }

    const resultados = (await buscarProductosEnPadron(q, 40)).map(fichaPadronABusqueda);
    return NextResponse.json({ data: resultados });
  } catch (e) {
    console.error('Error buscando productos:', e);
    return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
  }
}
