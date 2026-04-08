import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPadronPorProductos, getPadronPerfumeriaMap } from '@/lib/padron-final-db';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';

type ItemRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  /** Momento en que se cargó la línea al control (controles_vencimientos_detalle.fecha_registro) */
  fecha_registro: string;
  cantidad: number;
  /** Suma de cantidad_vendida en vencimientos_detalle_ventas para esta línea */
  cantidad_vendida_acumulada: number;
  /** 1 si la línea quedó marcada vendida en el control (puede tener cantidad 0) */
  vendido: number;
  sucursal_id: number;
  sucursal_nombre?: string | null;
};

type ReglaColumnas = {
  diasMinField: string;
  diasMaxField: string;
};

const DIAS_MIN_FIELDS = ['dias_min', 'diasmin', 'diasMin', 'fecha_min'] as const;
const DIAS_MAX_FIELDS = ['dias_max', 'diasmax', 'diasMax', 'fecha_max'] as const;
const SUBRUBRO_TODOS = '-';

async function resolverColumnasReglas(
  admin: Awaited<ReturnType<typeof createAdminClient>>
): Promise<ReglaColumnas | null> {
  for (const dMin of DIAS_MIN_FIELDS) {
    for (const dMax of DIAS_MAX_FIELDS) {
      const { error } = await admin
        .from('descuentos_vencimientos_reglas')
        .select(`id, id_categoriafinal, descuento, ${dMin}, ${dMax}`)
        .limit(1);
      if (!error) return { diasMinField: dMin, diasMaxField: dMax };
    }
  }
  return null;
}

function parseFechaISOaUTC(fecha: string): number {
  const [y, m, d] = String(fecha).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

/** GET /api/vencimientos/por-vencer?days=30&daysMin=0&cat_macro=...&categoria=...&vista=por_vencer|vendidos|vencidos
 * - vista omitida o por_vencer: fechas de vencimiento entre hoy y hoy+days (incluye liquidados).
 * - vendidos: mismo rango de fechas futuro, solo líneas liquidadas (restante 0 o vendido=1).
 * - vencidos: fechas de vencimiento entre hoy-days y ayer (solo ya vencidos en esa ventana).
 * GET ...?consolidado=1 (solo admin): todas las sucursales; opcional &sucursal=id
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const consolidado = searchParams.get('consolidado') === '1';

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;

  if (!consolidado && !sucursalCookie) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }
  if (consolidado && operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const daysMinRaw = parseInt(searchParams.get('daysMin') ?? '0', 10);
  const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
  const catMacroFiltro = String(searchParams.get('cat_macro') ?? '').trim();
  const categoriaFiltro = String(searchParams.get('categoria') ?? '').trim();
  const sucursalQueryRaw = searchParams.get('sucursal');
  const sucursalFiltroNum = sucursalQueryRaw != null && sucursalQueryRaw !== '' ? parseInt(sucursalQueryRaw, 10) : NaN;

  const vistaRaw = String(searchParams.get('vista') ?? '').toLowerCase();
  const vista =
    vistaRaw === 'vendidos' || vistaRaw === 'vencidos' ? (vistaRaw as 'vendidos' | 'vencidos') : 'por_vencer';

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];
  const hoyMid = parseFechaISOaUTC(hoyStr);
  const hasta = new Date(hoy.getTime() + days * 86400000).toISOString().split('T')[0];
  const desdePasado = new Date(hoy.getTime() - days * 86400000).toISOString().split('T')[0];

  const admin = await createAdminClient();

  const selectNormal =
    'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, fecha_registro, cantidad, vendido, controles_vencimientos!inner(sucursal_id)';
  const selectConsolidado =
    'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, fecha_registro, cantidad, vendido, controles_vencimientos!inner(sucursal_id, sucursales(nombrefantasia))';

  let detalleQuery = admin
    .from('controles_vencimientos_detalle')
    .select(consolidado ? selectConsolidado : selectNormal)
    .order('fecha_vencimiento', { ascending: vista !== 'vencidos' });

  if (vista === 'vencidos') {
    detalleQuery = detalleQuery.gte('fecha_vencimiento', desdePasado).lt('fecha_vencimiento', hoyStr);
  } else {
    detalleQuery = detalleQuery.gte('fecha_vencimiento', hoyStr).lte('fecha_vencimiento', hasta);
  }

  if (consolidado) {
    if (Number.isFinite(sucursalFiltroNum) && sucursalFiltroNum > 0) {
      detalleQuery = detalleQuery.eq('controles_vencimientos.sucursal_id', sucursalFiltroNum);
    }
  } else {
    detalleQuery = detalleQuery.eq('controles_vencimientos.sucursal_id', parseInt(sucursalCookie!, 10));
  }

  const { data: detalles, error } = await detalleQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (detalles ?? []) as any[];
  const rowsDentroRango = rows.filter((r) => {
    const fechaV = parseFechaISOaUTC(String(r.fecha_vencimiento));
    if (!Number.isFinite(fechaV)) return false;
    const dias = Math.floor((fechaV - hoyMid) / 86400000);
    if (vista === 'vencidos') {
      return dias < 0 && dias >= -days;
    }
    if (vista === 'vendidos') {
      if (dias < daysMin) return false;
      const cant = Number(r.cantidad ?? 0);
      const ven = Number(r.vendido ?? 0);
      return cant <= 0 || ven === 1;
    }
    return dias >= daysMin;
  });

  const ventasPorDetalle = await sumarCantidadVendidaPorDetalle(
    admin,
    rowsDentroRango.map((r) => String(r.id))
  );

  const sucursalIdCookieNum = sucursalCookie ? parseInt(sucursalCookie, 10) : 0;

  const items: ItemRow[] = rowsDentroRango.map((r) => {
    const cv = r.controles_vencimientos as {
      sucursal_id?: number;
      sucursales?: { nombrefantasia?: string | null } | null;
    };
    const sid = consolidado ? Number(cv?.sucursal_id ?? 0) : sucursalIdCookieNum;
    const sn = consolidado
      ? String(cv?.sucursales?.nombrefantasia ?? '').trim() || (sid ? `Sucursal ${sid}` : '')
      : undefined;
    return {
      id: r.id,
      control_id: r.control_id,
      producto_id_sistema: r.producto_id_sistema,
      codigo_barras: r.codigo_barras,
      descripcion: r.descripcion,
      presentacion: r.presentacion ?? null,
      laboratorio: r.laboratorio ?? null,
      fecha_vencimiento: r.fecha_vencimiento,
      fecha_registro: String(r.fecha_registro ?? ''),
      cantidad: Number(r.cantidad ?? 0),
      cantidad_vendida_acumulada: ventasPorDetalle.get(String(r.id)) ?? 0,
      vendido: Number(r.vendido ?? 0) ? 1 : 0,
      sucursal_id: sid,
      sucursal_nombre: sn,
    };
  });

  let padronMap = new Map<string, { cat_macro: string | null; categoria: string | null; subrubro: string | null }>();
  let padronPerfumeria: Awaited<ReturnType<typeof getPadronPerfumeriaMap>> | null = null;
  try {
    padronMap = await getPadronPorProductos(items.map((i) => i.producto_id_sistema));
    padronPerfumeria = await getPadronPerfumeriaMap();
  } catch (e) {
    return NextResponse.json(
      { error: `Error consultando base de abastecimiento: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const reglaCols = await resolverColumnasReglas(admin);
  let descuentosRows: Array<Record<string, unknown>> = [];
  let categoriasFinalesRows: Array<{
    id: number;
    subrubro_nombre: string;
    categoria: string;
    categoria_final: string;
  }> = [];
  if (reglaCols) {
    const { data: categoriasFinales } = await admin
      .from('categorias_finales')
      .select('id, subrubro_nombre, categoria, categoria_final');
    categoriasFinalesRows = (categoriasFinales ?? []) as typeof categoriasFinalesRows;

    const { data: descuentos } = await admin
      .from('descuentos_vencimientos_reglas')
      .select(`id, id_categoriafinal, descuento, ${reglaCols.diasMinField}, ${reglaCols.diasMaxField}`);
    descuentosRows = (descuentos ?? []) as unknown as Array<Record<string, unknown>>;
  }

  const catFinalByKey = new Map<string, number>();
  const catFinalByCategoria = new Map<string, number>();
  for (const c of categoriasFinalesRows) {
    const subrubroNorm = String(c.subrubro_nombre ?? '').trim();
    const categoriaNorm = String(c.categoria ?? '').trim();
    const key = `${subrubroNorm}|${categoriaNorm}`;
    if (!catFinalByKey.has(key)) catFinalByKey.set(key, Number(c.id));
    if (subrubroNorm === SUBRUBRO_TODOS && !catFinalByCategoria.has(categoriaNorm)) {
      catFinalByCategoria.set(categoriaNorm, Number(c.id));
    }
  }

  const reglas = reglaCols
    ? descuentosRows.map((r) => ({
        categoriaFinalId: Number(r.id_categoriafinal),
        descuento: Number(r.descuento),
        diasMin: Number(r[reglaCols.diasMinField]),
        diasMax: Number(r[reglaCols.diasMaxField]),
      }))
    : [];

  const enriquecidosTodos = items.map((i) => {
    const p = padronMap.get(String(i.producto_id_sistema));
    const padronRef =
      (i.codigo_barras ? padronPerfumeria?.byCodebar.get(String(i.codigo_barras).trim()) : undefined) ??
      (i.producto_id_sistema ? padronPerfumeria?.byCodplex.get(String(i.producto_id_sistema).trim()) : undefined);
    const fechaV = parseFechaISOaUTC(String(i.fecha_vencimiento));
    const diasHasta = Number.isFinite(fechaV) ? Math.floor((fechaV - hoyMid) / 86400000) : 0;

    const categoria = p?.categoria ?? null;
    const categoriaParaRegla = String(padronRef?.categoria ?? categoria ?? '').trim() || null;
    const subrubroParaRegla = String(padronRef?.subrubro ?? p?.subrubro ?? '').trim() || null;
    const catFinalId =
      (categoriaParaRegla && subrubroParaRegla
        ? catFinalByKey.get(`${subrubroParaRegla}|${categoriaParaRegla}`)
        : undefined) ??
      (categoriaParaRegla ? catFinalByCategoria.get(categoriaParaRegla) : undefined);
    const candidatas = reglas
      .filter((x) => x.categoriaFinalId === catFinalId && diasHasta >= x.diasMin && diasHasta <= x.diasMax)
      .sort((a, b) => {
        const rA = a.diasMax - a.diasMin;
        const rB = b.diasMax - b.diasMin;
        if (rA !== rB) return rA - rB;
        return b.descuento - a.descuento;
      });
    const descuentoAplicado = candidatas.length > 0 ? Number(candidatas[0].descuento) : null;

    return {
      ...i,
      cat_macro: p?.cat_macro ?? null,
      categoria,
      descuento_aplicado: descuentoAplicado,
    };
  });

  const catMacros = Array.from(
    new Set(
      enriquecidosTodos
        .map((i) => String(i.cat_macro ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const categorias = Array.from(
    new Set(
      enriquecidosTodos
        .map((i) => String(i.categoria ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const enriquecidos = enriquecidosTodos.filter((i) => {
    if (catMacroFiltro && String(i.cat_macro ?? '') !== catMacroFiltro) return false;
    if (categoriaFiltro && String(i.categoria ?? '') !== categoriaFiltro) return false;
    return true;
  });

  let sucursales: Array<{ sucursal: number; nombrefantasia: string }> | undefined;
  if (consolidado) {
    const { data: sucRows } = await admin
      .from('sucursales')
      .select('sucursal, nombrefantasia')
      .order('sucursal', { ascending: true });
    sucursales = (sucRows ?? []).map((s) => ({
      sucursal: Number((s as { sucursal: number }).sucursal),
      nombrefantasia: String((s as { nombrefantasia?: string | null }).nombrefantasia ?? ''),
    }));
  }

  return NextResponse.json({
    data: enriquecidos,
    cat_macros: catMacros,
    categorias,
    sucursales,
    consolidado,
    days,
    daysMin,
    vista,
    desde: hoyStr,
    hasta,
  });
}

/** DELETE /api/vencimientos/por-vencer?id=detalle_id
 * Elimina un registro de vencimiento (por venta u otra razón).
 */
export async function DELETE(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalCookie = cookieStore.get('sucursal_id')?.value;
  if (!sucursalCookie) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const cantidadParam = searchParams.get('cantidad');
  const cantidadVenta = cantidadParam ? parseInt(cantidadParam, 10) : null;
  if (cantidadParam && (!Number.isFinite(cantidadVenta) || (cantidadVenta ?? 0) <= 0)) {
    return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Verificar que el detalle pertenece a la sucursal actual (via join con control)
  const { data: row, error: rowError } = await admin
    .from('controles_vencimientos_detalle')
    .select('id, cantidad, controles_vencimientos!inner(sucursal_id)')
    .eq('id', id)
    .maybeSingle();

  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

  const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
  if (String(sucursalRow) !== String(sucursalCookie)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  const cantidadActual = Number((row as any).cantidad ?? 0);
  if (!Number.isFinite(cantidadActual) || cantidadActual <= 0) {
    return NextResponse.json({ error: 'El registro no tiene cantidad disponible' }, { status: 400 });
  }

  const cantidadAplicar = cantidadVenta ?? cantidadActual;
  if (cantidadAplicar > cantidadActual) {
    return NextResponse.json(
      { error: `La cantidad a vender no puede ser mayor a ${cantidadActual}` },
      { status: 400 }
    );
  }

  const nuevoRestante = cantidadActual - cantidadAplicar;
  const payload =
    nuevoRestante <= 0
      ? { vendido: 1, cantidad: 0 }
      : { cantidad: nuevoRestante };

  const { error } = await admin
    .from('controles_vencimientos_detalle')
    .update(payload)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const restanteFinal = Math.max(0, nuevoRestante);
  const { error: ventaErr } = await admin.from('vencimientos_detalle_ventas').insert({
    detalle_id: id,
    cantidad_vendida: cantidadAplicar,
    cantidad_restante_despues: restanteFinal,
    linea_vendida_completa: restanteFinal <= 0 ? 1 : 0,
    usuario_id: operador.idoperador,
    sucursal_id: parseInt(sucursalCookie, 10),
  });
  if (ventaErr) {
    console.error('vencimientos_detalle_ventas insert:', ventaErr);
    return NextResponse.json(
      { error: `Actualizado el stock pero no se pudo registrar el historial de venta: ${ventaErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, cantidad_vendida: cantidadAplicar, cantidad_restante: restanteFinal });
}

