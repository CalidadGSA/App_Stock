import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import { getPadronPorProductos, getPadronPerfumeriaMap } from '@/lib/padron-final-db';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';
import { createAdminClient } from '@/lib/supabase/server';

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

export type GetPorVencerListArgs = {
  admin: AdminClient;
  consolidado: boolean;
  sucursalCookie: string | null;
  sucursalFiltroNum: number;
  days: number;
  daysMin: number;
  catMacroFiltro: string;
  categoriaFiltro: string;
  vista: VistaPorVencerList;
  /** Solo vista sucursal: consulta MySQL Onze (pesada). Nunca en consolidado. */
  includeVentaPosteriorMysql: boolean;
  /**
   * Si es false, no filtra por cat_macro/categoría en el servidor (el cliente filtra sobre el lote ya cargado).
   * Consolidado y APIs que dependen del filtro server-side siguen con true (default).
   */
  aplicarFiltrosPadronEnServidor?: boolean;
};

export type PorVencerListPayload = {
  data: unknown[];
  cat_macros: string[];
  categorias: string[];
  sucursales?: Array<{ sucursal: number; nombrefantasia: string }>;
  consolidado: boolean;
  days: number;
  daysMin: number;
  vista: VistaPorVencerList;
  desde: string;
  hasta: string;
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
    vista,
    includeVentaPosteriorMysql,
    aplicarFiltrosPadronEnServidor = true,
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

  let detalleQuery = admin
    .from('controles_vencimientos_detalle')
    .select(consolidado ? selectConsolidado : selectNormal)
    .eq('eliminado', 0)
    .eq('devuelto', 0)
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
    return { ok: false, error: error.message, status: 500 };
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
      : items;

  let ventaPosteriorMap = new Map<string, boolean>();
  if (includeVentaPosteriorMysql) {
    const { getVentaPosteriorFlagsForDetalles } = await import('@/lib/legacy-db/mysql-stock');
    ventaPosteriorMap = await getVentaPosteriorFlagsForDetalles(
      itemsForPipeline.map((i) => ({
        detalleId: i.id,
        sucursalId: Number(i.sucursal_id),
        productoId: Number(i.producto_id_sistema),
        fechaRegistroIso: String(i.fecha_registro ?? ''),
      }))
    );
  }

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

  const enriquecidosTodos = itemsForPipeline.map((i) => {
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
      venta_posterior_a_carga: ventaPosteriorMap.get(i.id) === true,
    };
  });

  const catMacros = Array.from(
    new Set(
      enriquecidosTodos
        .map((i) => String((i as { cat_macro?: string | null }).cat_macro ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const categorias = Array.from(
    new Set(
      enriquecidosTodos
        .map((i) => String((i as { categoria?: string | null }).categoria ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const enriquecidos = aplicarFiltrosPadronEnServidor
    ? enriquecidosTodos.filter((i) => {
        const row = i as { cat_macro?: string | null; categoria?: string | null };
        if (catMacroFiltro && String(row.cat_macro ?? '') !== catMacroFiltro) return false;
        if (categoriaFiltro && String(row.categoria ?? '') !== categoriaFiltro) return false;
        return true;
      })
    : enriquecidosTodos;

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

  return {
    ok: true,
    payload: {
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
