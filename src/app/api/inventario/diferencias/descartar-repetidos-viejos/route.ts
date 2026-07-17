import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { idsDuplicadosMasViejosADescartar } from '@/lib/inventario/ajustes-duplicados';
import { rangoUtcAjustesInventario } from '@/lib/inventario/ajustes-query-fecha';
import { NextRequest, NextResponse } from 'next/server';

type Body = {
  sucursal_id?: number | string;
  desde?: string;
  hasta?: string;
  origen?: 'Sucursal' | 'Auditoria' | 'todos' | null;
};

/** POST — marca como ajustadas las diferencias repetidas más viejas (queda la más reciente). */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requirePermission('admin.ajustes');
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sucursalId = parseInt(String(body.sucursal_id ?? ''), 10);
  const desde = String(body.desde ?? '').trim();
  const hasta = String(body.hasta ?? '').trim();
  const origen = body.origen ?? 'todos';

  if (!Number.isFinite(sucursalId) || !desde || !hasta) {
    return NextResponse.json(
      { error: 'sucursal_id, desde y hasta son requeridos' },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();
  const { desdeIso, hastaIso } = rangoUtcAjustesInventario(desde, hasta);

  let query = admin
    .from('controles_inventario_detalle')
    .select(
      'id, producto_id_sistema, codigo_barras, fecha_registro, controles_inventario!inner(fecha_fin, sucursal_id, origen, estado)'
    )
    .eq('controles_inventario.sucursal_id', sucursalId)
    .eq('controles_inventario.estado', 'cerrado')
    .not('controles_inventario.fecha_fin', 'is', null)
    .gte('controles_inventario.fecha_fin', desdeIso)
    .lte('controles_inventario.fecha_fin', hastaIso)
    .eq('con_diferencias', 1)
    .eq('ajustado', 0);

  if (origen === 'Sucursal' || origen === 'Auditoria') {
    query = query.eq('controles_inventario.origen', origen);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    producto_id_sistema: string;
    codigo_barras: string | null;
    fecha_registro?: string | null;
    controles_inventario?: { fecha_fin?: string | null } | { fecha_fin?: string | null }[] | null;
  };

  const filas = (data ?? []) as Row[];
  const items = filas.map((r) => {
    const ctrlRaw = r.controles_inventario;
    const ctrl = Array.isArray(ctrlRaw) ? ctrlRaw[0] : ctrlRaw;
    return {
      id: r.id,
      producto_id_sistema: r.producto_id_sistema,
      codigo_barras: r.codigo_barras,
      fecha_registro: r.fecha_registro,
      fecha_fin_control: ctrl?.fecha_fin ?? null,
    };
  });

  const idsDescartar = idsDuplicadosMasViejosADescartar(items);
  if (idsDescartar.length === 0) {
    return NextResponse.json({
      ok: true,
      descartados: 0,
      grupos_con_repetidos: 0,
      conservados: items.length,
    });
  }

  const chunkSize = 200;
  for (let i = 0; i < idsDescartar.length; i += chunkSize) {
    const lote = idsDescartar.slice(i, i + chunkSize);
    const { error: updErr } = await admin
      .from('controles_inventario_detalle')
      .update({ ajustado: 1 })
      .in('id', lote);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  const gruposConRepetidos = new Set(
    items
      .filter((d) =>
        items.some(
          (o) =>
            o.id !== d.id &&
            o.producto_id_sistema === d.producto_id_sistema &&
            String(o.codigo_barras ?? '') === String(d.codigo_barras ?? '')
        )
      )
      .map((d) => `${d.producto_id_sistema}::${d.codigo_barras ?? ''}`)
  ).size;

  return NextResponse.json({
    ok: true,
    descartados: idsDescartar.length,
    grupos_con_repetidos: gruposConRepetidos,
    conservados: items.length - idsDescartar.length,
  });
}
