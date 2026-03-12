import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/ajustes/[id]/export - re-exportar el CSV de un ajuste existente (solo admin) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { id } = await params;
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
    .select('idProducto, codigo_barras, diferencia_cajas, diferencia_unidades')
    .eq('ajuste_id', id);

  if (detError) {
    return NextResponse.json({ error: detError.message }, { status: 500 });
  }

  type Row = {
    idProducto: string;
    codigo_barras: string;
    diferencia_cajas: number;
    diferencia_unidades: number;
  };

  let csv = 'idProducto,codigo_barras,diferencia_cajas,diferencia_unidades\n';
  for (const r of ((detalles as Row[]) ?? [])) {
    const cols = [
      r.idProducto ?? '',
      r.codigo_barras ?? '',
      r.diferencia_cajas.toString(),
      r.diferencia_unidades.toString(),
    ];
    const escaped = cols.map((c) => `"${String(c).replace(/"/g, '""')}"`);
    csv += `${escaped.join(',')}\n`;
  }

  const filename = ajuste.archivo_nombre as string;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

