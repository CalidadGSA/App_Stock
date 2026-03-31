import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { serializarCsvAjuste, type FormatoCsvAjuste } from '@/lib/csv-ajuste';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/ajustes/[id]/export - re-exportar el CSV de un ajuste existente (solo admin) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { id } = await params;
  const formatoParam = request.nextUrl.searchParams.get('formato');
  const formato: FormatoCsvAjuste =
    formatoParam === 'legacy'
      ? 'legacy'
      : formatoParam === 'import'
        ? 'import'
        : 'gsa';
  const admin = await createAdminClient();

  const { data: ajuste, error: ajusteError } = await admin
    .from('ajustes')
    .select('id, archivo_nombre')
    .eq('id', id)
    .maybeSingle();

  if (ajusteError || !ajuste) {
    return NextResponse.json({ error: 'Ajuste no encontrado' }, { status: 404 });
  }

  const { data: detalles, error: detError } = await admin
    .from('ajustes_detalle')
    .select('idproducto, codigo_barras, diferencia_cajas, diferencia_unidades')
    .eq('ajuste_id', id);

  if (detError) {
    return NextResponse.json({ error: detError.message }, { status: 500 });
  }

  type Row = {
    idproducto: string;
    codigo_barras: string;
    diferencia_cajas: number;
    diferencia_unidades: number;
  };

  const filas = ((detalles as Row[]) ?? []).map((r) => ({
    idproducto: r.idproducto ?? '',
    codigo_barras: r.codigo_barras ?? '',
    diferencia_cajas: r.diferencia_cajas ?? 0,
    diferencia_unidades: r.diferencia_unidades ?? 0,
  }));
  const csv = serializarCsvAjuste(filas, formato);

  const filename = ajuste.archivo_nombre as string;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

