import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/inventario/export - exporta diferencias de inventario a CSV (solo admin) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sucursalIdParam = searchParams.get('sucursal_id');
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');

  if (!sucursalIdParam || !desde || !hasta) {
    return NextResponse.json(
      { error: 'sucursal_id, desde y hasta son requeridos' },
      { status: 400 }
    );
  }

  const sucursalId = parseInt(sucursalIdParam, 10);
  if (Number.isNaN(sucursalId)) {
    return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Obtener nombre de sucursal
  const { data: sucursal, error: sucError } = await admin
    .from('sucursales')
    .select('nombrefantasia')
    .eq('sucursal', sucursalId)
    .maybeSingle();

  if (sucError || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
  }

  const desdeIso = `${desde}T00:00:00.000Z`;
  const hastaIso = `${hasta}T23:59:59.999Z`;

  // Traer detalles de inventario con unión a controles para filtrar por sucursal y fecha
  const { data: detalles, error: detError } = await admin
    .from('controles_inventario_detalle')
    .select(
      'producto_id_sistema, codigo_barras, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, controles_inventario!inner(fecha_inicio, sucursal_id)'
    )
    .eq('controles_inventario.sucursal_id', sucursalId)
    .gte('controles_inventario.fecha_inicio', desdeIso)
    .lte('controles_inventario.fecha_inicio', hastaIso);

  if (detError) {
    return NextResponse.json({ error: detError.message }, { status: 500 });
  }

  // Agrupar por producto + código de barras y acumular diferencias
  type Row = {
    producto_id_sistema: string;
    codigo_barras: string;
    stock_sist_cajas?: number | null;
    stock_sist_unidades?: number | null;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
  };

  const mapa = new Map<
    string,
    { idProducto: string; codigo: string; diffCajas: number; diffUnidades: number }
  >();

  for (const d of (detalles as Row[] ?? [])) {
    const key = `${d.producto_id_sistema}::${d.codigo_barras}`;
    const sistC = d.stock_sist_cajas ?? 0;
    const sistU = d.stock_sist_unidades ?? 0;
    const realC = d.stock_real_cajas ?? 0;
    const realU = d.stock_real_unidades ?? 0;

    const deltaC = realC - sistC;
    const deltaU = realU - sistU;

    if (!mapa.has(key)) {
      mapa.set(key, {
        idProducto: d.producto_id_sistema,
        codigo: d.codigo_barras,
        diffCajas: 0,
        diffUnidades: 0,
      });
    }

    const agg = mapa.get(key)!;
    agg.diffCajas += deltaC;
    agg.diffUnidades += deltaU;
  }

  const filas = Array.from(mapa.values()).filter(
    (r) => r.diffCajas !== 0 || r.diffUnidades !== 0
  );

  // Construir CSV UTF-8
  let csv = 'idProducto,codigo_barras,diferencia_cajas,diferencia_unidades\n';
  for (const r of filas) {
    const cols = [
      r.idProducto ?? '',
      r.codigo ?? '',
      r.diffCajas.toString(),
      r.diffUnidades.toString(),
    ];
    const escaped = cols.map((c) =>
      `"${String(c).replace(/"/g, '""')}"`
    );
    csv += `${escaped.join(',')}\n`;
  }

  const sucursalNombre = (sucursal as { nombrefantasia: string }).nombrefantasia;
  const safeNombre = sucursalNombre.replace(/[^A-Za-z0-9 _-]/g, '');
  const filename = `Inventario ${safeNombre} ${desde} a ${hasta}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

