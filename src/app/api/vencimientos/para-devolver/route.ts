import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { getOperadorRbacContext, isSuperAdminContext } from '@/lib/auth/rbac';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';
import { resolverVentaPosteriorFlags } from '@/lib/vencimientos-venta-posterior';
import { getPadronPorProductos } from '@/lib/padron-final-db';
import { fechaHoyArgentinaYmd } from '@/lib/utils';
import {
  entraEnListaParaDevolverConMacro,
  macroParaReglaDevolucion,
  rangoFechasVencimientoQuery,
} from '@/lib/vencimientos/para-devolver';
import {
  obligatorioObservacionDevolucion,
  ratioVendidoSobreOriginal,
  tieneObservacionDevolucion,
} from '@/lib/vencimientos/observacion-devolucion';
import {
  cargarMapaDrogueriaPorCodlab,
  cargarIdSubrubroPorProducto,
  cargarMedicamentoMetaPorProducto,
  cargarNombresPsicofarmacos,
  cargarIdsTrazables,
  esProductoTrazable,
  controlVencimientoDesdeFila,
  macroBultoParaProducto,
  metaMedicamentoPorProducto,
  padronParaProducto,
  type MedicamentoDrogueriaMeta,
  type MacroBulto,
  type PadronProductoResumen,
  opcionesFiltroBulto,
  resolverDrogueriaDevolucion,
  FILTRO_TRAZABLES,
  SIN_DROGUERIA_ASIGNADA,
} from '@/lib/vencimientos-drogueria-lab';
import { parsePaginationParams, slicePaginated } from '@/lib/api/pagination';

type ItemRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro: string | null;
  cantidad: number;
  categoria_macro: string | null;
  accion_observacion: string | null;
  cantidad_vendida_acumulada: number;
  cantidad_cargada_original: number;
  /** Vendidos / carga original (0–1). */
  ratio_vendido_sobre_original: number | null;
  /** Si hace falta texto para poder devolver (vendido &lt; 50 % de la carga original). */
  obligatorio_observacion_devolucion: boolean;
  venta_posterior_a_carga?: boolean;
  codlab?: number | null;
  drogueria_devolucion?: string | null;
  trazable?: boolean;
};

function enriquecerItem(
  base: Omit<
    ItemRow,
    | 'accion_observacion'
    | 'cantidad_vendida_acumulada'
    | 'cantidad_cargada_original'
    | 'ratio_vendido_sobre_original'
    | 'obligatorio_observacion_devolucion'
  > & { accion_observacion: string | null },
  ventasMap: Map<string, number>,
  omitirObsSiSuperadmin = false
): ItemRow {
  const vend = ventasMap.get(base.id) ?? 0;
  const rest = Number(base.cantidad) || 0;
  const orig = rest + vend;
  const ratio = ratioVendidoSobreOriginal(rest, vend);
  return {
    ...base,
    accion_observacion: base.accion_observacion,
    cantidad_vendida_acumulada: vend,
    cantidad_cargada_original: orig,
    ratio_vendido_sobre_original: ratio,
    obligatorio_observacion_devolucion: obligatorioObservacionDevolucion(orig, vend, {
      omitirSiSuperadmin: omitirObsSiSuperadmin,
    }),
  };
}

/** GET /api/vencimientos/para-devolver
 * No devueltos con ventana por macro (mes calendario):
 * BIENESTAR → menos de 10 días para vencer; FARMA/PSICO → mes anterior al vencimiento (&lt;40 días en ese mes).
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const rbacCtx = await getOperadorRbacContext();
  const omitirObsSiSuperadmin = rbacCtx ? isSuperAdminContext(rbacCtx) : false;

  const { searchParams } = new URL(request.url);
  const checkVentaPosterior = searchParams.get('check_venta_posterior') !== '0';
  const pagination = parsePaginationParams(searchParams);
  const drogueriaFiltro = String(searchParams.get('drogueria') ?? '').trim();
  const categoriaFiltro = String(
    searchParams.get('categoria_macro') ?? searchParams.get('categoria') ?? ''
  ).trim();
  const busqueda = String(searchParams.get('busqueda') ?? '').trim().toLowerCase();
  const sortKey = String(searchParams.get('sortBy') ?? 'vencimiento').trim();
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const hoyStr = fechaHoyArgentinaYmd();
  const { desde: desdeStr, hasta: hastaStr } = rangoFechasVencimientoQuery(hoyStr);

  const rows: any[] = [];
  const chunkSize = 1000;
  let from = 0;
  while (true) {
    const { data: batch, error } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, fecha_registro, cantidad, vendido, devuelto, accion_observacion, controles_vencimientos!inner(sucursal_id, categoria_macro)'
      )
      .eq('controles_vencimientos.sucursal_id', parseInt(sucursalId, 10))
      .gte('fecha_vencimiento', desdeStr)
      .lte('fecha_vencimiento', hastaStr)
      .eq('devuelto', 0)
      .eq('eliminado', 0)
      .gt('cantidad', 0)
      .order('fecha_vencimiento', { ascending: true })
      .range(from, from + chunkSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const parsed = (batch ?? []) as any[];
    rows.push(...parsed);
    if (parsed.length < chunkSize) break;
    from += chunkSize;
  }
  const fechaRegistroById = new Map<string, string>();
  for (const r of rows) {
    const id = String(r.id ?? '');
    const fr = String(r.fecha_registro ?? '').trim();
    if (id && fr) fechaRegistroById.set(id, fr);
  }

  const productoIds = Array.from(
    new Set(rows.map((r) => String(r.producto_id_sistema ?? '').trim()).filter(Boolean))
  );

  const padronPorProducto = new Map<string, PadronProductoResumen>();
  try {
    const chunkSize = 800;
    for (let i = 0; i < productoIds.length; i += chunkSize) {
      const lote = productoIds.slice(i, i + chunkSize);
      const padronLote = await getPadronPorProductos(lote);
      for (const [k, v] of padronLote) {
        const entry: PadronProductoResumen = {
          cat_macro: v.cat_macro,
          categoria: v.categoria,
          subrubro: v.subrubro,
        };
        const key = String(k).trim();
        if (!key) continue;
        padronPorProducto.set(key, entry);
        const num = Number(key);
        if (Number.isFinite(num)) padronPorProducto.set(String(num), entry);
      }
    }
  } catch (e) {
    console.warn('[para-devolver] Padrón cat_macro:', (e as Error).message);
  }

  let idSubrubroPorProducto = new Map<string, number | null>();
  try {
    idSubrubroPorProducto = await cargarIdSubrubroPorProducto(admin, productoIds);
  } catch (e) {
    console.warn('[para-devolver] medicamentos idsubrubro:', (e as Error).message);
  }

  let medicamentoMetaPorProducto = new Map<string, MedicamentoDrogueriaMeta>();
  let nombrePsicoPorId = new Map<string, string>();
  try {
    medicamentoMetaPorProducto = await cargarMedicamentoMetaPorProducto(admin, productoIds);
  } catch (e) {
    console.warn('[para-devolver] medicamentos codlab/psico:', (e as Error).message);
  }
  try {
    nombrePsicoPorId = await cargarNombresPsicofarmacos(admin);
  } catch (e) {
    console.warn('[para-devolver] psicofarmacos:', (e as Error).message);
  }

  const prelim: Array<
    Omit<
      ItemRow,
      | 'cantidad_vendida_acumulada'
      | 'cantidad_cargada_original'
      | 'ratio_vendido_sobre_original'
      | 'obligatorio_observacion_devolucion'
    > & { accion_observacion: string | null }
  > = [];

  for (const r of rows) {
    const pid = String(r.producto_id_sistema ?? '').trim();
    const padron = padronParaProducto(padronPorProducto, pid);
    const meta = metaMedicamentoPorProducto(medicamentoMetaPorProducto, pid);
    const controlMacro = (
      Array.isArray(r.controles_vencimientos)
        ? r.controles_vencimientos[0]
        : r.controles_vencimientos
    ) as { categoria_macro?: string | null } | null | undefined;
    const idsubrubro =
      idSubrubroPorProducto.get(pid) ??
      (Number.isFinite(Number(pid)) ? idSubrubroPorProducto.get(String(Number(pid))) : undefined) ??
      null;
    const cat = macroParaReglaDevolucion(
      padron,
      meta,
      nombrePsicoPorId,
      idsubrubro,
      controlMacro?.categoria_macro ?? null
    );
    const fechaVencStr = String(r.fecha_vencimiento ?? '').trim().slice(0, 10);
    if (!entraEnListaParaDevolverConMacro(cat, fechaVencStr, hoyStr)) continue;
    if (Number(r.vendido ?? 0) === 1) continue;
    prelim.push({
      id: r.id as string,
      control_id: r.control_id as string,
      producto_id_sistema: pid,
      codigo_barras: r.codigo_barras as string,
      descripcion: r.descripcion as string,
      presentacion: (r.presentacion as string | null) ?? null,
      laboratorio: (r.laboratorio as string | null) ?? null,
      fecha_vencimiento: r.fecha_vencimiento as string,
      fecha_registro: String(r.fecha_registro ?? '').trim() || null,
      cantidad: Number(r.cantidad ?? 0),
      categoria_macro: cat,
      accion_observacion:
        r.accion_observacion != null && String(r.accion_observacion).trim() !== ''
          ? String(r.accion_observacion)
          : null,
    });
  }

  const ventasMap = await sumarCantidadVendidaPorDetalle(
    admin,
    prelim.map((p) => p.id)
  );

  const baseItems: ItemRow[] = prelim.map((p) =>
    enriquecerItem(
      {
        ...p,
        accion_observacion: p.accion_observacion,
      },
      ventasMap,
      omitirObsSiSuperadmin
    )
  );

  let bultoOpciones: string[] = [];
  let drogueriaPorCodlab = new Map<number, { drogueria: string; laboratorio: string; codlab: number }>();
  let idsTrazables = new Set<number>();

  try {
    const mapaDrogueria = await cargarMapaDrogueriaPorCodlab(admin);
    bultoOpciones = opcionesFiltroBulto(mapaDrogueria.droguerias);
    drogueriaPorCodlab = mapaDrogueria.porCodlab;
  } catch (e) {
    console.warn('[vencidos] vencimientos_drogueria_laboratorio:', (e as Error).message);
    bultoOpciones = opcionesFiltroBulto([]);
  }

  if (!bultoOpciones.includes(FILTRO_TRAZABLES)) {
    bultoOpciones = [...bultoOpciones, FILTRO_TRAZABLES];
  }

  try {
    idsTrazables = await cargarIdsTrazables(admin);
  } catch (e) {
    console.warn('[vencidos] trazables:', (e as Error).message);
  }

  let itemsConDrogueria = baseItems.map((i) => {
    const meta = metaMedicamentoPorProducto(medicamentoMetaPorProducto, i.producto_id_sistema);
    const codlab = meta?.codlab ?? null;
    const padron = padronParaProducto(padronPorProducto, i.producto_id_sistema);
    const macroEfectiva: MacroBulto | null =
      macroBultoParaProducto(padron, meta, nombrePsicoPorId) ??
      (i.categoria_macro as MacroBulto | null);
    const trazable = esProductoTrazable(i.producto_id_sistema, idsTrazables);
    const drogueria_devolucion = resolverDrogueriaDevolucion(
      {
        producto_id_sistema: i.producto_id_sistema,
        laboratorio: i.laboratorio,
        fecha_vencimiento: i.fecha_vencimiento,
      },
      macroEfectiva,
      meta,
      drogueriaPorCodlab,
      nombrePsicoPorId,
      hoyStr,
      idsTrazables
    );
    return {
      ...i,
      codlab,
      trazable,
      drogueria_devolucion,
    };
  });

  let filtrados = itemsConDrogueria;
  if (drogueriaFiltro) {
    if (drogueriaFiltro === FILTRO_TRAZABLES) {
      filtrados = filtrados.filter((i) => Boolean(i.trazable));
    } else {
      filtrados = filtrados.filter(
        (i) => String(i.drogueria_devolucion ?? '').trim() === drogueriaFiltro
      );
    }
  }
  if (categoriaFiltro) {
    filtrados = filtrados.filter((i) => String(i.categoria_macro ?? '') === categoriaFiltro);
  }
  if (busqueda) {
    filtrados = filtrados.filter((i) => {
      const texto = [
        i.descripcion,
        i.presentacion ?? '',
        i.laboratorio ?? '',
        i.codigo_barras,
        i.producto_id_sistema,
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(busqueda);
    });
  }

  const valorSort = (i: ItemRow): string | number => {
    if (sortKey === 'producto') return String(i.descripcion ?? '').toLowerCase();
    if (sortKey === 'macro') return String(i.categoria_macro ?? '').toLowerCase();
    if (sortKey === 'vencimiento') return String(i.fecha_vencimiento ?? '');
    if (sortKey === 'cantidad') return Number(i.cantidad_cargada_original ?? 0);
    if (sortKey === 'restante') return Number(i.cantidad ?? 0);
    return Number(i.cantidad_vendida_acumulada ?? 0);
  };

  filtrados = [...filtrados].sort((a, b) => {
    const va = valorSort(a);
    const vb = valorSort(b);
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const paginado = slicePaginated(filtrados, pagination);
  let paginaItems = paginado.data;

  const sinObservacionDevolucionIds = filtrados
    .filter(
      (i) =>
        i.obligatorio_observacion_devolucion &&
        !tieneObservacionDevolucion(i.accion_observacion)
    )
    .map((i) => i.id);

  let ventaPosteriorMap = new Map<string, boolean>();
  let ventaPosteriorCheck: 'off' | 'full' | 'skipped_slow_db' | 'skipped_unavailable' = 'off';
  let ventaPosteriorMysqlLatencyMs: number | null = null;

  if (checkVentaPosterior) {
    const resolved = await resolverVentaPosteriorFlags(
      paginaItems.map((i) => ({
        detalleId: i.id,
        sucursalId: parseInt(sucursalId, 10),
        productoId: Number(i.producto_id_sistema),
        fechaRegistroIso: fechaRegistroById.get(i.id) ?? '',
      })),
      true
    );
    ventaPosteriorMap = resolved.map;
    ventaPosteriorCheck = resolved.status;
    ventaPosteriorMysqlLatencyMs = resolved.mysqlLatencyMs;
  }

  const items: ItemRow[] = paginaItems.map((i) => ({
    ...i,
    venta_posterior_a_carga: ventaPosteriorMap.get(i.id) === true,
  }));

  return NextResponse.json({
    data: items,
    total: paginado.total,
    page: paginado.page,
    pageSize: paginado.pageSize,
    sin_observacion_devolucion: sinObservacionDevolucionIds.length,
    sin_observacion_devolucion_ids: sinObservacionDevolucionIds,
    hoy: hoyStr,
    desde: desdeStr,
    hasta: hastaStr,
    droguerias: bultoOpciones,
    sin_drogueria_valor: SIN_DROGUERIA_ASIGNADA,
    venta_posterior_check: ventaPosteriorCheck,
    venta_posterior_mysql_latency_ms: ventaPosteriorMysqlLatencyMs,
  });
}

/** PATCH /api/vencimientos/para-devolver
 * - Body `{ id, accion_observacion }` → guarda observación
 * - `?id=&cantidad=` → marca venta (registra en vencimientos_detalle_ventas)
 * - `?devolver_todos=1` + body `{ ids }` → devolución masiva
 */
export async function PATCH(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const rbacCtx = await getOperadorRbacContext();
  const omitirObsSiSuperadmin = rbacCtx ? isSuperAdminContext(rbacCtx) : false;

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const devolverTodos = searchParams.get('devolver_todos') === '1';
  const cantidadParam = searchParams.get('cantidad');
  const cantidadVenta = cantidadParam ? parseInt(cantidadParam, 10) : null;
  if (cantidadParam && (!Number.isFinite(cantidadVenta) || (cantidadVenta ?? 0) <= 0)) {
    return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });
  }

  const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const admin = await createAdminClient();

  if (devolverTodos) {
    const ids = Array.isArray(rawBody?.ids) ? (rawBody!.ids as string[]) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids requeridos para devolver_todos' }, { status: 400 });
    }

    const { data: detalles, error: detError } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, accion_observacion, controles_vencimientos!inner(sucursal_id, categoria_macro)'
      )
      .in('id', ids);

    if (detError) {
      return NextResponse.json({ error: detError.message }, { status: 500 });
    }

    const rows = (detalles ?? []) as any[];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Registros no encontrados' }, { status: 404 });
    }

    for (const r of rows) {
      const sucursalRow = r.controles_vencimientos?.sucursal_id;
      if (String(sucursalRow) !== String(sucursalId)) {
        return NextResponse.json({ error: 'Sin acceso a uno o más registros' }, { status: 403 });
      }
    }

    const ventasMap = await sumarCantidadVendidaPorDetalle(
      admin,
      rows.map((r) => String(r.id))
    );

    const productosSinObservacion: string[] = [];
    if (!omitirObsSiSuperadmin) {
      for (const r of rows) {
        const vend = ventasMap.get(String(r.id)) ?? 0;
        const rest = Number(r.cantidad ?? 0);
        const orig = rest + vend;
        if (!obligatorioObservacionDevolucion(orig, vend)) continue;
        const obs = String(r.accion_observacion ?? '').trim();
        if (!tieneObservacionDevolucion(obs)) {
          productosSinObservacion.push(String(r.descripcion ?? r.codigo_barras ?? r.id));
        }
      }
    }

    if (productosSinObservacion.length > 0) {
      return NextResponse.json(
        {
          error:
            'Hay productos con menos del 50 % vendido que requieren una observación antes de devolver.',
          productos_sin_observacion: productosSinObservacion,
        },
        { status: 400 }
      );
    }

    const { data: cab, error: cabError } = await admin
      .from('devoluciones_vencimientos')
      .insert({
        sucursal_id: parseInt(sucursalId, 10),
        usuario_id: operador.idoperador,
      })
      .select()
      .single();

    if (cabError || !cab) {
      return NextResponse.json(
        { error: cabError?.message ?? 'Error al registrar la devolución' },
        { status: 500 }
      );
    }

    const devolucionId = cab.id as string;

    const detalleRows = rows.map((r) => ({
      devolucion_id: devolucionId,
      detalle_vencimiento_id: r.id as string,
      control_id: r.control_id as string,
      producto_id_sistema: r.producto_id_sistema as string,
      codigo_barras: r.codigo_barras as string,
      descripcion: r.descripcion as string,
      presentacion: (r.presentacion as string | null) ?? null,
      laboratorio: (r.laboratorio as string | null) ?? null,
      fecha_vencimiento: r.fecha_vencimiento as string,
      cantidad: Number(r.cantidad ?? 0),
      categoria_macro: (r.controles_vencimientos?.categoria_macro as string | null) ?? null,
      accion_observacion: (() => {
        const t = String(r.accion_observacion ?? '').trim();
        return t ? t : null;
      })(),
    }));

    const { error: detInsError } = await admin.from('devoluciones_vencimientos_detalle').insert(detalleRows);

    if (detInsError) {
      return NextResponse.json({ error: detInsError.message }, { status: 500 });
    }

    const { error: updError } = await admin
      .from('controles_vencimientos_detalle')
      .update({ vendido: 0, devuelto: 1 })
      .in('id', ids);

    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, devolucion_id: devolucionId });
  }

  if (
    rawBody &&
    typeof rawBody === 'object' &&
    rawBody.id != null &&
    Object.prototype.hasOwnProperty.call(rawBody, 'accion_observacion')
  ) {
    const bid = String(rawBody.id);
    const texto =
      typeof rawBody.accion_observacion === 'string' ? rawBody.accion_observacion : String(rawBody.accion_observacion ?? '');

    const { data: row, error: rowError } = await admin
      .from('controles_vencimientos_detalle')
      .select('id, controles_vencimientos!inner(sucursal_id)')
      .eq('id', bid)
      .maybeSingle();

    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });

    const sucursalRow = (row as any).controles_vencimientos?.sucursal_id;
    if (String(sucursalRow) !== String(sucursalId)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    const trimmed = texto.trim();
    const { error: upErr } = await admin
      .from('controles_vencimientos_detalle')
      .update({ accion_observacion: trimmed || null })
      .eq('id', bid);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, accion_observacion: trimmed || null });
  }

  if (id && !devolverTodos) {
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
    if (String(sucursalRow) !== String(sucursalId)) {
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
      nuevoRestante <= 0 ? { vendido: 1, cantidad: 0 } : { cantidad: nuevoRestante };

    const { error } = await admin.from('controles_vencimientos_detalle').update(payload).eq('id', id);
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
      sucursal_id: parseInt(sucursalId, 10),
    });
    if (ventaErr) {
      console.error('vencimientos_detalle_ventas insert (para-devolver):', ventaErr);
      return NextResponse.json(
        {
          error: `Actualizado el stock pero no se pudo registrar el historial de venta: ${ventaErr.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      cantidad_vendida: cantidadAplicar,
      cantidad_restante: restanteFinal,
    });
  }

  return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
}
