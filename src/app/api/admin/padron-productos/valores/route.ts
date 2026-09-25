import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { getPadronPool } from '@/lib/padron-final-db';
import {
  COLUMNAS_PADRON_CON_CATALOGO,
  esColumnaConCatalogo,
  type ValorCatalogo,
} from '@/lib/padron/valores-catalogo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/padron-productos/valores
 * Valores ya cargados en las columnas de clasificación, con cuántos productos usan cada uno.
 * El editor los usa para autocompletar y para avisar cuando alguien escribe uno nuevo.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  const pedida = String(request.nextUrl.searchParams.get('columna') ?? '').trim().toLowerCase();
  const columnas = pedida
    ? [pedida].filter(esColumnaConCatalogo)
    : [...COLUMNAS_PADRON_CON_CATALOGO];

  if (columnas.length === 0) {
    return NextResponse.json(
      { error: `Columna sin catálogo. Disponibles: ${COLUMNAS_PADRON_CON_CATALOGO.join(', ')}.` },
      { status: 400 }
    );
  }

  try {
    const pool = getPadronPool();
    const catalogos: Record<string, ValorCatalogo[]> = {};

    for (const columna of columnas) {
      // El nombre sale de una lista fija, nunca del parámetro crudo.
      const { rows } = await pool.query(
        `SELECT BTRIM(${columna}) AS valor, COUNT(*)::int AS usos
         FROM padron_final
         WHERE NULLIF(BTRIM(${columna}), '') IS NOT NULL
         GROUP BY BTRIM(${columna})
         ORDER BY COUNT(*) DESC`
      );

      catalogos[columna] = (rows as Array<{ valor: string; usos: number }>).map((r) => ({
        valor: String(r.valor),
        usos: Number(r.usos ?? 0),
      }));
    }

    return NextResponse.json({ catalogos });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error al leer los valores del padrón';
    console.error('GET padron-productos/valores:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
