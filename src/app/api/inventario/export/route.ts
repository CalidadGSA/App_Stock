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
  const origen = searchParams.get('origen'); // 'Sucursal' | 'Auditoria' | null

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
  let query = admin
    .from('controles_inventario_detalle')
    .select(
      'id, producto_id_sistema, codigo_barras, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, controles_inventario!inner(fecha_inicio, sucursal_id, origen)'
    )
    .eq('controles_inventario.sucursal_id', sucursalId)
    .gte('controles_inventario.fecha_inicio', desdeIso)
    .lte('controles_inventario.fecha_inicio', hastaIso)
    .eq('con_diferencias', 1)
    .eq('ajustado', 0);

  if (origen === 'Sucursal' || origen === 'Auditoria') {
    query = query.eq('controles_inventario.origen', origen);
  }

  const { data: detalles, error: detError } = await query;

  if (detError) {
    return NextResponse.json({ error: detError.message }, { status: 500 });
  }

  type Row = {
    id: string;
    producto_id_sistema: string;
    codigo_barras: string;
    stock_sist_cajas?: number | null;
    stock_sist_unidades?: number | null;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
    con_diferencias?: number | null;
    ajustado?: number | null;
    // join
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controles_inventario?: { origen?: string } | any;
  };

  const filasDet: {
    idDetalle: string;
    idProducto: string;
    codigo: string;
    diffCajas: number;
    diffUnidades: number;
    origenControl: string;
  }[] = [];

  for (const d of ((detalles as Row[]) ?? [])) {
    if (d.ajustado === 1) continue;
    const sistC = d.stock_sist_cajas ?? 0;
    const sistU = d.stock_sist_unidades ?? 0;
    const realC = d.stock_real_cajas ?? 0;
    const realU = d.stock_real_unidades ?? 0;

    const deltaC = realC - sistC;
    const deltaU = realU - sistU;

    if (deltaC === 0 && deltaU === 0) continue;

    const origenControl =
      d.controles_inventario && typeof d.controles_inventario === 'object'
        ? (d.controles_inventario.origen as string | undefined) ?? 'Sucursal'
        : 'Sucursal';

    filasDet.push({
      idDetalle: d.id,
      idProducto: d.producto_id_sistema,
      codigo: d.codigo_barras,
      diffCajas: deltaC,
      diffUnidades: deltaU,
      origenControl,
    });
  }

  // Construir CSV UTF-8 sin cabecera (una fila por detalle con diferencia)
  let csv = '';
  for (const r of filasDet) {
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

  // Marcar detalles como ajustados y registrar en tablas de ajustes.
  // Si algo falla, devolvemos error para no dejar un CSV exportado sin reflejo en la base.
  if (filasDet.length > 0) {
    const { data: ajuste, error: ajusteError } = await admin
      .from('ajustes')
      .insert({
        sucursal_id: sucursalId,
        usuario_id: operador.idoperador,
        fecha_desde: desde,
        fecha_hasta: hasta,
        archivo_nombre: filename,
      })
      .select()
      .single();

    if (ajusteError || !ajuste) {
      return NextResponse.json(
        { error: ajusteError?.message ?? 'Error al registrar el ajuste exportado' },
        { status: 500 }
      );
    }

    const ajusteId = ajuste.id as string;
    const detallesRows = filasDet.map((r) => ({
      ajuste_id: ajusteId,
      detalle_id: r.idDetalle,
      idproducto: r.idProducto,
      codigo_barras: r.codigo,
      diferencia_cajas: r.diffCajas,
      diferencia_unidades: r.diffUnidades,
    }));

    const { error: ajusteDetalleError } = await admin
      .from('ajustes_detalle')
      .insert(detallesRows);

    if (ajusteDetalleError) {
      return NextResponse.json(
        { error: ajusteDetalleError.message },
        { status: 500 }
      );
    }

    const idsAuditoria = filasDet
      .filter((r) => r.origenControl === 'Auditoria')
      .map((r) => r.idDetalle);
    const idsSucursal = filasDet
      .filter((r) => r.origenControl !== 'Auditoria')
      .map((r) => r.idDetalle);

    if (idsAuditoria.length > 0) {
      const { error: updateAuditError } = await admin
        .from('controles_inventario_detalle')
        .update({
          estado: 'ajustado_auditoria',
          ajustado: 1,
        })
        .in('id', idsAuditoria);

      if (updateAuditError) {
        return NextResponse.json(
          { error: updateAuditError.message },
          { status: 500 }
        );
      }
    }

    if (idsSucursal.length > 0) {
      const { error: updateSucursalError } = await admin
        .from('controles_inventario_detalle')
        .update({
          estado: 'ajustado_sucursal',
          ajustado: 1,
        })
        .in('id', idsSucursal);

      if (updateSucursalError) {
        return NextResponse.json(
          { error: updateSucursalError.message },
          { status: 500 }
        );
      }
    }
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

