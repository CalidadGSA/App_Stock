import { getOperadorSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/** Evita que el término rompa el patrón ILIKE o amplíe matches de forma accidental. */
function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/\\/g, ' ').replace(/%/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

const TIENE_LETRAS = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/;

// GET /api/productos/buscar?q=texto
// Busca en medicamentos por nombre (Producto + Presentaci) o por código de barras.
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = sanitizeIlikeTerm(searchParams.get('q') ?? '');

  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  const admin = await createAdminClient();
  const like = `%${q}%`;
  const seen = new Map<number, Record<string, unknown>>();

  function mergeRows(rows: Record<string, unknown>[] | null | undefined) {
    for (const m of rows ?? []) {
      const row = m as { codplex: number };
      const id = Number(row.codplex);
      if (!seen.has(id)) seen.set(id, m as Record<string, unknown>);
      if (seen.size >= 40) break;
    }
  }

  const soloDigitos = /^\d+$/.test(q);

  if (soloDigitos) {
    const troquelNum = Number(q);
    const { data: troquelRows, error: troquelError } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, activo')
      .eq('troquel', troquelNum)
      .eq('activo', 'S')
      .eq('visible', 1)
      .neq('troquel', 0)
      .limit(20);

    if (troquelError) {
      console.error('Error buscando medicamentos por troquel:', troquelError);
      return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
    }
    mergeRows(troquelRows as Record<string, unknown>[] | undefined);
  }

  if (soloDigitos && q.length >= 6) {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, activo')
      .or(
        `codebar.ilike.${like},codebar2.ilike.${like},codebar3.ilike.${like},codebar4.ilike.${like}`
      )
      .eq('activo', 'S')
      .eq('visible', 1)
      .neq('troquel', 0)
      .limit(50);

    if (error) {
      console.error('Error buscando medicamentos por código (largo):', error);
      return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
    }
    mergeRows(data as Record<string, unknown>[] | undefined);
  }

  if (!soloDigitos && TIENE_LETRAS.test(q)) {
    if (q.length < 3) {
      return NextResponse.json({ data: [] });
    }
    const { data: porProducto, error: errP } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, activo')
      .ilike('producto', like)
      .eq('activo', 'S')
      .eq('visible', 1)
      .neq('troquel', 0)
      .limit(45);

    if (errP) {
      console.error('Error buscando medicamentos por producto:', errP);
      return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
    }
    mergeRows(porProducto as Record<string, unknown>[] | undefined);

    if (seen.size < 40) {
      const { data: porPres, error: errPr } = await admin
        .from('medicamentos')
        .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, activo')
        .ilike('presentaci', like)
        .eq('activo', 'S')
        .eq('visible', 1)
        .neq('troquel', 0)
        .limit(45);

      if (errPr) {
        console.error('Error buscando medicamentos por presentación:', errPr);
        return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
      }
      mergeRows(porPres as Record<string, unknown>[] | undefined);
    }
  }

  if (soloDigitos && seen.size === 0 && q.length < 6) {
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, codlab, activo')
      .or(
        `codebar.ilike.${like},codebar2.ilike.${like},codebar3.ilike.${like},codebar4.ilike.${like}`
      )
      .eq('activo', 'S')
      .eq('visible', 1)
      .neq('troquel', 0)
      .limit(50);

    if (error) {
      console.error('Error buscando medicamentos por código (corto):', error);
      return NextResponse.json({ error: 'Error al buscar productos' }, { status: 500 });
    }
    mergeRows(data as Record<string, unknown>[] | undefined);
  }

  const merged = Array.from(seen.values());
  if (merged.length === 0) {
    return NextResponse.json({ data: [] });
  }

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

  const resultados = merged
    .map((m: any) => ({
      producto_id_sistema: String(m.codplex),
      codigo_barras: m.codebar as string | null,
      troquel: (m.troquel as string | null) ?? null,
      descripcion: (m.producto as string | null) ?? '',
      presentacion: (m.presentaci as string | null) ?? null,
      laboratorio:
        m.codlab != null ? labMap.get(m.codlab as number) ?? String(m.codlab) : null,
    }))
    .slice(0, 40);

  return NextResponse.json({ data: resultados });
}
