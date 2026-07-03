import { EXPORT_MAX_ROWS } from '@/lib/api/pagination';
import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import { esLineaSinLiquidar } from '@/lib/vencimientos/por-vencer-saldo';
import { getPadronPorProductos, getPadronPerfumeriaMap } from '@/lib/padron-final-db';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';
import { createAdminClient } from '@/lib/supabase/server';
import { pasaFiltroMesAnioYmd } from '@/lib/vencimientos-mes-anio-filtro';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type ItemRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  fecha_registro: string;
  cantidad: number;
  accion_observacion: string | null;
  cantidad_vendida_acumulada: number;
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

async function resolverColumnasReglas(admin: AdminClient): Promise<ReglaColumnas | null> {
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

export type VistaPorVencerList = 'por_vencer' | 'vendidos' | 'vencidos' | 'vendido_parcial';

export type SortKeyPorVencerList =
  | 'producto'
  | 'categoria'
  | 'carga'
  | 'vencimiento'
  | 'restante'
  | 'vendido';

export type GetPorVencerListArgs = {
  admin: AdminClient;
  consolidado: boolean;
  sucursalCookie: string | null;
  sucursalFiltroNum: number;
  days: number;
  daysMin: number;
  catMacroFiltro: string;
  categoriaFiltro: string;
  laboratorioFiltro?: string;
  vista: VistaPorVencerList;
  /** Solo vista sucursal: consulta MySQL Onze (pesada). Nunca en consolidado. */
  includeVentaPosteriorMysql: boolean;
  /**
   * Si es false, no filtra por cat_macro/categoría en el servidor (el cliente filtra sobre el lote ya cargado).
   * Consolidado y APIs que dependen del filtro server-side siguen con true (default).
   */
  aplicarFiltrosPadronEnServidor?: boolean;
  page?: number;
  pageSize?: number;
  unpaginated?: boolean;
  busqueda?: string;
  mesVenc?: number;
  anioVenc?: number;
  soloVentaPosterior?: boolean;
  sortBy?: SortKeyPorVencerList;
  sortDir?: 'asc' | 'desc';
  /** Paginar por filas agrupadas (producto + vencimiento). Solo vista sucursal. */
  agruparFilas?: boolean;
  /** Enriquecer todo el lote y devolver solo líneas con descuento (export/listado descuentos). */
  modoListaDescuentos?: boolean;
};

export type VentaPosteriorCheckStatus =
  | 'off'
  | 'full'
  | 'skipped_slow_db'
  | 'skipped_unavailable';

export type PorVencerListPayload = {
  data: unknown[];
  total: number;
  total_lineas: number;
  page: number;
  pageSize: number;
  cat_macros: string[];
  categorias: string[];
  laboratorios: string[];
  sucursales?: Array<{ sucursal: number; nombrefantasia: string }>;
  consolidado: boolean;
  days: number;
  daysMin: number;
  vista: VistaPorVencerList;
  desde: string;
  hasta: string;
  venta_posterior_check?: VentaPosteriorCheckStatus;
  venta_posterior_mysql_latency_ms?: number | null;
  totales?: {
    lineas: number;
    cajasRestantes: number;
    cajasVendidasHist: number;
    cajasMovimientoTotal: number;
    lineasLiquidados: number;
  };
};

export type GetPorVencerListResult =
  | { ok: true; payload: PorVencerListPayload }
  | { ok: false; error: string; status: number };

export async function getPorVencerListPayload(args: GetPorVencerListArgs): Promise<GetPorVencerListResult> {
  const {
    admin,
    consolidado,
    sucursalCookie,
    sucursalFiltroNum,
    days,
    daysMin,
    catMacroFiltro,
    categoriaFiltro,
    laboratorioFiltro = '',
    vista,
    includeVentaPosteriorMysql,
    aplicarFiltrosPadronEnServidor = true,
    page = 1,
    pageSize = 20,
    unpaginated = false,
    busqueda = '',
    mesVenc,
    anioVenc,
    soloVentaPosterior = false,
    sortBy = 'vencimiento',
    sortDir = 'asc',
    agruparFilas = false,
    modoListaDescuentos = false,
  } = args;

  if (!consolidado && !sucursalCookie) {
    return { ok: false, error: 'Sucursal no seleccionada', status: 400 };
  }
  if (includeVentaPosteriorMysql && consolidado) {
    return { ok: false, error: 'Venta posterior no aplica a consolidado', status: 500 };
  }

  const hoyStr = fechaHoyArgentinaYmd();
  const hoyMid = parseFechaISOaUTC(hoyStr);
  const hasta = ymdAddDays(hoyStr, days);
  const desdePasado = ymdAddDays(hoyStr, -days);

  const selectNormal =
    'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, fecha_registro, cantidad, vendido, accion_observacion, controles_vencimientos!inner(sucursal_id)';
  const selectConsolidado =
    'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, fecha_registro, cantidad, vendido, accion_observacion, controles_vencimientos!inner(sucursal_id, sucursales(nombrefantasia))';

  const buildDetalleQuery = () => {
    let q = admin
      .from('controles_vencimientos_detalle')
      .select(consolidado ? selectConsolidado : selectNormal)
      .eq('eliminado', 0);
    // Vencidos: no filtrar por devuelto (muchas líneas quedan devuelto=1 con saldo aún cargado).
    if (vista !== 'vencidos') {
      q = q.eq('devuelto', 0);
    }
    q = q.order('fecha_vencimiento', { ascending: vista !== 'vencidos' });

    if (vista === 'vencidos') {
      q = q.gte('fecha_vencimiento', desdePasado).lt('fecha_vencimiento', hoyStr);
    } else {
      q = q.gte('fecha_vencimiento', hoyStr).lte('fecha_vencimiento', hasta);
    }

    if (consolidado) {
      if (Number.isFinite(sucursalFiltroNum) && sucursalFiltroNum > 0) {
        q = q.eq('controles_vencimientos.sucursal_id', sucursalFiltroNum);
      }
    } else {
      q = q.eq('controles_vencimientos.sucursal_id', parseInt(sucursalCookie!, 10));
    }
    return q;
  };

  // Supabase puede devolver un maximo de ~1000 filas por consulta.
  // Leemos en paginas para evitar truncar consolidado y exportaciones.
  const rows: any[] = [];
  const chunkSize = 1000;
  let from = 0;
  while (true) {
    const to = from + chunkSize - 1;
    const { data: batch, error } = await buildDetalleQuery().range(from, to);
    if (error) {
      return { ok: false, error: error.message, status: 500 };
    }
    const parsed = (batch ?? []) as any[];
    rows.push(...parsed);
    if (parsed.length < chunkSize) break;
    from += chunkSize;
  }
  const rowsDentroRango = rows.filter((r) => {
    const fechaV = parseFechaISOaUTC(String(r.fecha_vencimiento));
    if (!Number.isFinite(fechaV)) return false;
    const dias = Math.floor((fechaV - hoyMid) / 86400000);
    if (vista === 'vencidos') {
      if (!esLineaSinLiquidar(r.cantidad, r.vendido)) return false;
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
      accion_observacion: (() => {
        const t = String(r.accion_observacion ?? '').trim();
        return t ? t : null;
      })(),
      cantidad_vendida_acumulada: ventasPorDetalle.get(String(r.id)) ?? 0,
      vendido: Number(r.vendido ?? 0) ? 1 : 0,
      sucursal_id: sid,
      sucursal_nombre: sn,
    };
  });

  const itemsForPipeline =
    vista === 'vendido_parcial'
      ? items.filter(
          (i) =>
            Number(i.cantidad) > 0 &&
            Number(i.cantidad_vendida_acumulada ?? 0) >= 1 &&
            Number(i.vendido ?? 0) === 0
        )
      : vista === 'por_vencer' || vista === 'vencidos'
        ? items.filter((i) => esLineaSinLiquidar(i.cantidad, i.vendido))
        : items;

  let ventaPosteriorMap = new Map<string, boolean>();
  let ventaPosteriorCheck: VentaPosteriorCheckStatus = 'off';
  let ventaPosteriorMysqlLatencyMs: number | null = null;

  let padronMap = new Map<string, { cat_macro: string | null; categoria: string | null; subrubro: string | null }>();
  let padronPerfumeria: Awaited<ReturnType<typeof getPadronPerfumeriaMap>> | null = null;
  try {
    padronMap = await getPadronPorProductos(itemsForPipeline.map((i) => i.producto_id_sistema));
    padronPerfumeria = await getPadronPerfumeriaMap();
  } catch (e) {
    return {
      ok: false,
      error: `Error consultando base de abastecimiento: ${(e as Error).message}`,
      status: 500,
    };
  }

  type ItemConPadron = ItemRow & { cat_macro: string | null; categoria: string | null };

  let candidatos: ItemConPadron[] = itemsForPipeline.map((i) => {
    const p = padronMap.get(String(i.producto_id_sistema));
    return {
      ...i,
      cat_macro: p?.cat_macro ?? null,
      categoria: p?.categoria ?? null,
    };
  });

  const termBusqueda = busqueda.trim().toLowerCase();
  if (termBusqueda) {
    candidatos = candidatos.filter((i) => {
      const texto = [
        i.descripcion,
        i.presentacion ?? '',
        i.laboratorio ?? '',
        i.codigo_barras,
        i.producto_id_sistema,
        i.sucursal_nombre ?? '',
        String(i.sucursal_id ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(termBusqueda);
    });
  }

  if (mesVenc || anioVenc) {
    candidatos = candidatos.filter((i) =>
      pasaFiltroMesAnioYmd(i.fecha_vencimiento, mesVenc, anioVenc)
    );
  }

  const laboratorioFiltroTrim = laboratorioFiltro.trim();
  if (laboratorioFiltroTrim) {
    candidatos = candidatos.filter(
      (i) => String(i.laboratorio ?? '').trim() === laboratorioFiltroTrim
    );
  }

  if (aplicarFiltrosPadronEnServidor) {
    candidatos = candidatos.filter((i) => {
      if (catMacroFiltro && String(i.cat_macro ?? '') !== catMacroFiltro) return false;
      if (categoriaFiltro && String(i.categoria ?? '') !== categoriaFiltro) return false;
      return true;
    });
  }

  const catMacros = Array.from(
    new Set(
      itemsForPipeline
        .map((i) => String(padronMap.get(String(i.producto_id_sistema))?.cat_macro ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const categorias = Array.from(
    new Set(
      itemsForPipeline
        .map((i) => String(padronMap.get(String(i.producto_id_sistema))?.categoria ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const laboratorios = Array.from(
    new Set(
      itemsForPipeline
        .map((i) => String(i.laboratorio ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  if (soloVentaPosterior && includeVentaPosteriorMysql) {
    const resolved = await (
      await import('@/lib/vencimientos-venta-posterior')
    ).resolverVentaPosteriorFlags(
      candidatos.map((i) => ({
        detalleId: i.id,
        sucursalId: Number(i.sucursal_id),
        productoId: Number(i.producto_id_sistema),
        fechaRegistroIso: String(i.fecha_registro ?? ''),
      })),
      true
    );
    ventaPosteriorMap = resolved.map;
    ventaPosteriorCheck = resolved.status;
    ventaPosteriorMysqlLatencyMs = resolved.mysqlLatencyMs;
    candidatos = candidatos.filter((i) => ventaPosteriorMap.get(i.id) === true);
  }

  const paginado = modoListaDescuentos
    ? {
        data: candidatos,
        total: candidatos.length,
        total_lineas: candidatos.length,
        page: 1,
        pageSize: candidatos.length,
      }
    : paginarListadoPorVencer(candidatos, {
        page,
        pageSize,
        unpaginated,
        agruparFilas,
        sortBy,
        sortDir,
      });

  let totales: PorVencerListPayload['totales'];
  if (consolidado) {
    let cajasRestantes = 0;
    let cajasVendidasHist = 0;
    let lineasLiquidados = 0;
    for (const i of candidatos) {
      const r = Number(i.cantidad) || 0;
      const v = Number(i.cantidad_vendida_acumulada) || 0;
      cajasRestantes += r;
      cajasVendidasHist += v;
      if (r <= 0) lineasLiquidados += 1;
    }
    totales = {
      lineas: candidatos.length,
      cajasRestantes,
      cajasVendidasHist,
      cajasMovimientoTotal: cajasRestantes + cajasVendidasHist,
      lineasLiquidados,
    };
  }

  let paginaItems = paginado.data;

  if (includeVentaPosteriorMysql && !soloVentaPosterior) {
    const resolved = await (
      await import('@/lib/vencimientos-venta-posterior')
    ).resolverVentaPosteriorFlags(
      paginaItems.map((i) => ({
        detalleId: i.id,
        sucursalId: Number(i.sucursal_id),
        productoId: Number(i.producto_id_sistema),
        fechaRegistroIso: String(i.fecha_registro ?? ''),
      })),
      true
    );
    ventaPosteriorMap = resolved.map;
    ventaPosteriorCheck = resolved.status;
    ventaPosteriorMysqlLatencyMs = resolved.mysqlLatencyMs;
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

  const enriquecidos = paginaItems.map((i) => {
    const padronRef =
      (i.codigo_barras ? padronPerfumeria?.byCodebar.get(String(i.codigo_barras).trim()) : undefined) ??
      (i.producto_id_sistema ? padronPerfumeria?.byCodplex.get(String(i.producto_id_sistema).trim()) : undefined);
    const fechaV = parseFechaISOaUTC(String(i.fecha_vencimiento));
    const diasHasta = Number.isFinite(fechaV) ? Math.floor((fechaV - hoyMid) / 86400000) : 0;

    const categoria = i.categoria;
    const categoriaParaRegla = String(padronRef?.categoria ?? categoria ?? '').trim() || null;
    const subrubroParaRegla = String(padronRef?.subrubro ?? padronMap.get(String(i.producto_id_sistema))?.subrubro ?? '').trim() || null;
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
    const categoriaFinalDescuento =
      catFinalId != null
        ? categoriasFinalesRows.find((c) => Number(c.id) === catFinalId)?.categoria_final ?? null
        : null;

    return {
      ...i,
      descuento_aplicado: descuentoAplicado,
      categoria_final_descuento: categoriaFinalDescuento,
      venta_posterior_a_carga: ventaPosteriorMap.get(i.id) === true,
    };
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

  const dataFinal = modoListaDescuentos
    ? enriquecidos.filter(
        (i) => i.descuento_aplicado != null && Number.isFinite(Number(i.descuento_aplicado)) && Number(i.descuento_aplicado) > 0
      )
    : enriquecidos;

  return {
    ok: true,
    payload: {
      data: dataFinal,
      total: modoListaDescuentos ? dataFinal.length : paginado.total,
      total_lineas: modoListaDescuentos ? dataFinal.length : paginado.total_lineas,
      page: paginado.page,
      pageSize: paginado.pageSize,
      cat_macros: catMacros,
      categorias,
      laboratorios,
      sucursales,
      consolidado,
      days,
      daysMin,
      vista,
      desde: hoyStr,
      hasta,
      venta_posterior_check: ventaPosteriorCheck,
      venta_posterior_mysql_latency_ms: ventaPosteriorMysqlLatencyMs,
      totales,
    },
  };
}

/** Parsea `vista` desde query string (acepta alias `vendidos_parcial`). */
export function parseVistaPorVencerList(raw: string | null | undefined): VistaPorVencerList {
  const vistaRaw = String(raw ?? '').toLowerCase();
  if (vistaRaw === 'vendidos') return 'vendidos';
  if (vistaRaw === 'vencidos') return 'vencidos';
  if (vistaRaw === 'vendido_parcial' || vistaRaw === 'vendidos_parcial') return 'vendido_parcial';
  return 'por_vencer';
}

export function parseSortKeyPorVencerList(raw: string | null | undefined): SortKeyPorVencerList {
  const k = String(raw ?? '').trim();
  if (
    k === 'producto' ||
    k === 'categoria' ||
    k === 'carga' ||
    k === 'vencimiento' ||
    k === 'restante' ||
    k === 'vendido'
  ) {
    return k;
  }
  return 'vencimiento';
}

export type ProductoConDescuentoAplicado = {
  codigo_barras: string;
  categoria_final: string;
  descuento: number;
  cantidad: number;
  dias_hasta: number;
};

/** Misma base que «Por vencer» (sin paginar), solo líneas con regla de descuento aplicable. */
export async function listarProductosConDescuentoAplicado(args: {
  admin: AdminClient;
  sucursalId: number;
  days: number;
  daysMin: number;
}): Promise<
  | { ok: true; productos: ProductoConDescuentoAplicado[] }
  | { ok: false; error: string; status: number }
> {
  const result = await getPorVencerListPayload({
    admin: args.admin,
    consolidado: false,
    sucursalCookie: String(args.sucursalId),
    sucursalFiltroNum: NaN,
    days: args.days,
    daysMin: args.daysMin,
    catMacroFiltro: '',
    categoriaFiltro: '',
    vista: 'por_vencer',
    includeVentaPosteriorMysql: false,
    aplicarFiltrosPadronEnServidor: true,
    modoListaDescuentos: true,
    agruparFilas: false,
  });

  if (!result.ok) return result;

  const hoyStr = fechaHoyArgentinaYmd();
  const hoyMid = parseFechaISOaUTC(hoyStr);

  const productos: ProductoConDescuentoAplicado[] = [];
  for (const raw of result.payload.data as Array<{
    codigo_barras?: string | null;
    fecha_vencimiento?: string | null;
    cantidad?: number | null;
    descuento_aplicado?: number | null;
    categoria_final_descuento?: string | null;
  }>) {
    const desc = raw.descuento_aplicado;
    if (desc == null || !Number.isFinite(Number(desc)) || Number(desc) <= 0) continue;

    const codebar = String(raw.codigo_barras ?? '').trim();
    if (!codebar) continue;

    const fechaV = parseFechaISOaUTC(String(raw.fecha_vencimiento ?? ''));
    const diasHasta = Number.isFinite(fechaV) ? Math.floor((fechaV - hoyMid) / 86400000) : 0;

    productos.push({
      codigo_barras: codebar,
      categoria_final: String(raw.categoria_final_descuento ?? '').trim(),
      descuento: -Math.abs(Number(desc)),
      cantidad: Number(raw.cantidad ?? 0),
      dias_hasta: diasHasta,
    });
  }

  return { ok: true, productos };
}

function valorSortPorVencer(
  item: ItemRow & { categoria?: string | null; cantidad_vendida_acumulada?: number },
  sortKey: SortKeyPorVencerList
): string | number {
  if (sortKey === 'producto') return String(item.descripcion ?? '').toLowerCase();
  if (sortKey === 'categoria') return String(item.categoria ?? '').toLowerCase();
  if (sortKey === 'carga') return String(item.fecha_registro ?? '');
  if (sortKey === 'vencimiento') return String(item.fecha_vencimiento ?? '');
  if (sortKey === 'restante') return Number(item.cantidad ?? 0);
  return Number(item.cantidad_vendida_acumulada ?? 0);
}

function compararSortPorVencer(
  va: string | number,
  vb: string | number,
  sortDir: 'asc' | 'desc'
): number {
  let cmp = 0;
  if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
  else cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
  return sortDir === 'asc' ? cmp : -cmp;
}

function agruparItemsPorVencer<T extends ItemRow>(items: T[]): T[][] {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const k = `${i.producto_id_sistema}\t${i.fecha_vencimiento}`;
    const arr = map.get(k) ?? [];
    arr.push(i);
    map.set(k, arr);
  }
  return Array.from(map.values());
}

function paginarListadoPorVencer<T extends ItemRow & { categoria?: string | null }>(
  items: T[],
  opts: {
    page: number;
    pageSize: number;
    unpaginated: boolean;
    agruparFilas: boolean;
    sortBy: SortKeyPorVencerList;
    sortDir: 'asc' | 'desc';
  }
): { data: T[]; total: number; total_lineas: number; page: number; pageSize: number } {
  const pageSafe = Math.max(1, opts.page);
  const sizeSafe = opts.unpaginated
    ? EXPORT_MAX_ROWS
    : Math.min(500, Math.max(5, opts.pageSize));
  const total_lineas = items.length;

  if (opts.agruparFilas) {
    const grupos = agruparItemsPorVencer(items);
    const gruposOrdenados = [...grupos].sort((a, b) => {
      const va =
        opts.sortBy === 'restante'
          ? a.reduce((s, x) => s + (Number(x.cantidad) || 0), 0)
          : opts.sortBy === 'vendido'
            ? a.reduce((s, x) => s + (Number(x.cantidad_vendida_acumulada) || 0), 0)
            : valorSortPorVencer(a[0]!, opts.sortBy);
      const vb =
        opts.sortBy === 'restante'
          ? b.reduce((s, x) => s + (Number(x.cantidad) || 0), 0)
          : opts.sortBy === 'vendido'
            ? b.reduce((s, x) => s + (Number(x.cantidad_vendida_acumulada) || 0), 0)
            : valorSortPorVencer(b[0]!, opts.sortBy);
      return compararSortPorVencer(va, vb, opts.sortDir);
    });
    const total = gruposOrdenados.length;
    const offset = opts.unpaginated ? 0 : (pageSafe - 1) * sizeSafe;
    const pageGroups = gruposOrdenados.slice(
      offset,
      offset + (opts.unpaginated ? Math.min(gruposOrdenados.length, sizeSafe) : sizeSafe)
    );
    return {
      data: pageGroups.flat(),
      total,
      total_lineas,
      page: opts.unpaginated ? 1 : pageSafe,
      pageSize: sizeSafe,
    };
  }

  const ordenados = [...items].sort((a, b) =>
    compararSortPorVencer(valorSortPorVencer(a, opts.sortBy), valorSortPorVencer(b, opts.sortBy), opts.sortDir)
  );
  const total = ordenados.length;
  const offset = opts.unpaginated ? 0 : (pageSafe - 1) * sizeSafe;
  const limit = opts.unpaginated ? Math.min(ordenados.length, sizeSafe) : sizeSafe;
  return {
    data: ordenados.slice(offset, offset + limit),
    total,
    total_lineas: total,
    page: opts.unpaginated ? 1 : pageSafe,
    pageSize: sizeSafe,
  };
}
