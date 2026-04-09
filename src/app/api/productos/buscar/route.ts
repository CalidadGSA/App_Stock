import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/productos/buscar?q=texto
// Busca en medicamentos por nombre (Producto + Presentaci) o por código de barras.
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) {
    return NextResponse.json({ data: [] });
  }

  const admin = await createAdminClient();

  const like = `%${q}%`;
  const seen = new Map<number, Record<string, unknown>>();

  const { data, error } = await admin
    .from('medicamentos')
    .select('codplex, troquel, codebar, producto, presentaci, codlab, activo')
    .or(`codebar.ilike.${like},troquel.ilike.${like},producto.ilike.${like},presentaci.ilike.${like}`)
    .eq('activo', 'S')
    .limit(20);

  if (error) {
    console.error('Error buscando medicamentos por texto:', error);
    return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
  }

  for (const m of data ?? []) {
    const row = m as { codplex: number };
    const id = Number(row.codplex);
    if (!seen.has(id)) seen.set(id, m as Record<string, unknown>);
    if (seen.size >= 20) break;
  }

  const merged = Array.from(seen.values());
  if (merged.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // Resolver nombres de laboratorio
  const codlabs = Array.from(
    new Set(
      merged
        .map((m: any) => m.codlab as number | null)
        .filter((v): v is number => v != null)
    )
  );

  const labMap = new Map<number, string>();
  if (codlabs.length > 0) {
    const { data: labs } = await admin
      .from('laboratorios')
      .select('codlab, laborato')
      .in('codlab', codlabs);

    (labs ?? []).forEach((l: any) => {
      labMap.set(l.codlab as number, (l.laborato as string | null) ?? String(l.codlab));
    });
  }

  const resultados = merged.map((m: any) => ({
      producto_id_sistema: String(m.codplex),
      codigo_barras: m.codebar as string | null,
      troquel: (m.troquel as string | null) ?? null,
      descripcion: (m.producto as string | null) ?? '',
      presentacion: (m.presentaci as string | null) ?? null,
      laboratorio:
        m.codlab != null
          ? labMap.get(m.codlab as number) ?? String(m.codlab)
          : null,
    }));

  return NextResponse.json({ data: resultados });
}

