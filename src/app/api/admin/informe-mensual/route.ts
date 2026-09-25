import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  fechaHoyArgentinaYmd,
  parseYm,
  anteriorMesYm,
  rangoMedioAbiertoMesArgentinaYm,
  ymdAddDays,
} from '@/lib/utils';
import { queryBajasStockAgregado } from '@/lib/legacy-db/mysql-bajas-stock';
import { queryValesPorMes } from '@/lib/legacy-db/mysql-kpis-mensuales';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import {
  construirDetalleSucursalInformeMensual,
  rangoMesCalendarioYm,
  totalesDetalleInformeMensual,
  type InformeMensualDetalleSucursal,
  type InformeMensualDetalleTotales,
} from '@/lib/inventario/informe-mensual-metricas';
import { cargarDiferenciasCajasValorPorSucursal } from '@/lib/inventario/informe-mensual-diferencias-cajas';
import {
  normalizarDiferenciasValorAgregado,
  sumarDiferenciasValor,
  type DiferenciasValorAgregado,
  type DiferenciasValorFilaSucursal,
} from '@/lib/inventario/informe-mensual-diferencias-valor';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type { InformeMensualDetalleSucursal, InformeMensualDetalleTotales };

const TOTALES_MES_CERO = {
  productos_inventariados: 0,
  vencidos_cargados: 0,
  vencidos_costo: 0,
  vencidos_vendidas_unidades: 0,
  inventario_lineas_con_diferencia: 0,
  vales: 0,
  vales_pendientes: 0,
} as const;

const DIFERENCIAS_VALOR_CERO: DiferenciasValorAgregado = {
  valor_positivo: 0,
  valor_negativo: 0,
  valor_neto: 0,
  lineas_con_diferencia: 0,
};

function esTimeoutPostgres(msg: string): boolean {
  return /statement timeout|canceling statement|57014/i.test(msg);
}

/** Fila agregada por RPC (tendencias / compatibilidad). */
type InformeMensualFilaRpc = {
  sucursal_id: number;
  nombrefantasia: string;
  productos_inventariados: number;
  vencidos_cargados: number;
  vencidos_costo: number;
  vencidos_vendidas_unidades: number;
  inventario_lineas_con_diferencia: number;
};

export type InformeMensualTrendMes = {
  mes: string;
  totales: {
    productos_inventariados: number;
    vencidos_cargados: number;
    vencidos_costo: number;
    vencidos_vendidas_unidades: number;
    inventario_lineas_con_diferencia: number;
    /** Vales (comprobantes pendientes de entrega) generados en el mes, toda la cadena. */
    vales: number;
    vales_pendientes: number;
  };
  diferencias_valor: DiferenciasValorAgregado;
};

export type InformeMensualDiferenciasValorMes = {
  filasSucursal: DiferenciasValorFilaSucursal[];
  totales: DiferenciasValorAgregado;
};

export type InformeBajasStockTotales = {
  movimientos: number;
  cajas: number;
  unidades: number;
  valor_total: number;
};

export type InformeBajasStockTrendMes = {
  mes: string;
  totales: InformeBajasStockTotales;
};

export type InformeBajasStockFilaSucursal = {
  sucursal_id: number;
  nombrefantasia: string;
  movimientos: number;
  cajas: number;
  unidades: number;
  valor_total: number;
};

export type InformeBajasStockDetalleRow = {
  sucursal_id: number;
  ym: string;
  movimientos: number;
  cajas: number;
  unidades: number;
  valor_total: number;
};

export type InformeBajasStockSucursalOption = {
  sucursal_id: number;
  nombrefantasia: string;
};

const BAJAS_STOCK_CERO: InformeBajasStockTotales = {
  movimientos: 0,
  cajas: 0,
  unidades: 0,
  valor_total: 0,
};

const INVENTARIADOS_MES_CHUNK = 1000;

/** Productos distintos por sucursal en inventarios cerrados del mes (fecha_fin en [desde, hasta)). */
async function contarProductosInventariadosPorSucursalMes(
  admin: SupabaseClient,
  desdeIso: string,
  hastaExcIso: string
): Promise<Map<number, number>> {
  const porSucursal = new Map<number, Set<string>>();
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select('producto_id_sistema, controles_inventario!inner(sucursal_id, estado, fecha_fin)')
      .eq('controles_inventario.estado', 'cerrado')
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lt('controles_inventario.fecha_fin', hastaExcIso)
      .order('id', { ascending: true })
      .range(offset, offset + INVENTARIADOS_MES_CHUNK - 1);

    if (error) {
      console.error('contarProductosInventariadosPorSucursalMes:', error.message);
      break;
    }

    const batch = data ?? [];
    for (const row of batch) {
      const cv = row.controles_inventario as { sucursal_id?: number } | null;
      const sid = Number(cv?.sucursal_id);
      const pid = String(row.producto_id_sistema ?? '').trim();
      if (!Number.isFinite(sid) || !pid) continue;
      let set = porSucursal.get(sid);
      if (!set) {
        set = new Set<string>();
        porSucursal.set(sid, set);
      }
      set.add(pid);
    }

    if (batch.length < INVENTARIADOS_MES_CHUNK) break;
    offset += INVENTARIADOS_MES_CHUNK;
  }

  const counts = new Map<number, number>();
  for (const [sid, set] of porSucursal) {
    counts.set(sid, set.size);
  }
  return counts;
}

function rpcIncluyeProductosInventariados(
  filas: unknown[] | null | undefined
): boolean {
  const row = filas?.[0];
  return (
    row != null &&
    typeof row === 'object' &&
    Object.prototype.hasOwnProperty.call(row, 'productos_inventariados')
  );
}

function rpcIncluyeVencidosCosto(filas: unknown[] | null | undefined): boolean {
  const row = filas?.[0];
  return (
    row != null &&
    typeof row === 'object' &&
    Object.prototype.hasOwnProperty.call(row, 'vencidos_costo')
  );
}

async function cargarBajasStock(
  admin: SupabaseClient,
  trends: InformeMensualTrendMes[],
  mesSeleccionYm: string
) {
  const firstYm = trends[0]?.mes;
  const lastYm = trends[trends.length - 1]?.mes ?? mesSeleccionYm;
  const p0 = parseYm(firstYm ?? '');
  const p1 = parseYm(lastYm);
  if (!p0 || !p1) {
    return {
      disponible: false,
      error: 'Rango de meses inválido',
      trends: [] as InformeBajasStockTrendMes[],
      mesSeleccionado: { filasSucursal: [] as InformeBajasStockFilaSucursal[], totales: BAJAS_STOCK_CERO },
      detalle: [] as InformeBajasStockDetalleRow[],
      sucursales: [] as InformeBajasStockSucursalOption[],
    };
  }

  // `stock_operaciones.FechaHora` es hora local AR: el rango va en YYYY-MM-DD, sin pasar por UTC.
  const desdeYmd = `${p0.year}-${String(p0.month).padStart(2, '0')}-01`;
  const hastaExclusivoYmd = ymdAddDays(rangoMesCalendarioYm(p1.year, p1.month).fecha_fin, 1);
  if (!desdeYmd || !hastaExclusivoYmd) {
    return {
      disponible: false,
      error: 'Rango de fechas inválido',
      trends: [],
      mesSeleccionado: { filasSucursal: [], totales: BAJAS_STOCK_CERO },
      detalle: [],
      sucursales: [],
    };
  }

  const query = await queryBajasStockAgregado(desdeYmd, hastaExclusivoYmd);
  if (query.status !== 'ok') {
    return {
      disponible: false,
      error: query.error,
      trends: [],
      mesSeleccionado: { filasSucursal: [], totales: BAJAS_STOCK_CERO },
      detalle: [],
      sucursales: [],
    };
  }

  const { data: sucRows } = await admin.from('sucursales').select('sucursal, nombrefantasia');
  const nombreById = new Map<number, string>();
  for (const s of sucRows ?? []) {
    const id = Number((s as { sucursal?: number }).sucursal);
    if (!esSucursalVisibleEnLogin(id)) continue;
    nombreById.set(
      id,
      String((s as { nombrefantasia?: string | null }).nombrefantasia ?? '').trim() ||
        `Sucursal ${id}`
    );
  }

  const totalesPorYm = new Map<string, InformeBajasStockTotales>();
  for (const t of trends) {
    totalesPorYm.set(t.mes, { ...BAJAS_STOCK_CERO });
  }

  const porSucursalMes = new Map<number, InformeBajasStockTotales>();

  for (const r of query.rows) {
    const bucket = totalesPorYm.get(r.ym);
    if (bucket) {
      bucket.movimientos += r.movimientos;
      bucket.cajas += r.cajas;
      bucket.unidades += r.unidades;
      bucket.valor_total += r.valor_total;
    }

    if (r.ym === mesSeleccionYm) {
      const prev = porSucursalMes.get(r.sucursal_id) ?? { ...BAJAS_STOCK_CERO };
      prev.movimientos += r.movimientos;
      prev.cajas += r.cajas;
      prev.unidades += r.unidades;
      prev.valor_total += r.valor_total;
      porSucursalMes.set(r.sucursal_id, prev);
    }
  }

  const trendsBajas: InformeBajasStockTrendMes[] = trends.map((t) => ({
    mes: t.mes,
    totales: totalesPorYm.get(t.mes) ?? { ...BAJAS_STOCK_CERO },
  }));

  const filasSucursal: InformeBajasStockFilaSucursal[] = Array.from(porSucursalMes.entries())
    .map(([sucursal_id, t]) => ({
      sucursal_id,
      nombrefantasia: nombreById.get(sucursal_id) ?? `Sucursal ${sucursal_id}`,
      ...t,
    }))
    .sort((a, b) => b.movimientos - a.movimientos || a.nombrefantasia.localeCompare(b.nombrefantasia, 'es'));

  const totalesMes = filasSucursal.reduce(
    (acc, r) => ({
      movimientos: acc.movimientos + r.movimientos,
      cajas: acc.cajas + r.cajas,
      unidades: acc.unidades + r.unidades,
      valor_total: acc.valor_total + r.valor_total,
    }),
    { ...BAJAS_STOCK_CERO }
  );

  const detalle: InformeBajasStockDetalleRow[] = query.rows.map((r) => ({
    sucursal_id: r.sucursal_id,
    ym: r.ym,
    movimientos: r.movimientos,
    cajas: r.cajas,
    unidades: r.unidades,
    valor_total: r.valor_total,
  }));

  const sucursales: InformeBajasStockSucursalOption[] = Array.from(nombreById.entries())
    .map(([sucursal_id, nombrefantasia]) => ({ sucursal_id, nombrefantasia }))
    .sort((a, b) => a.nombrefantasia.localeCompare(b.nombrefantasia, 'es'));

  return {
    disponible: true,
    trends: trendsBajas,
    mesSeleccionado: { filasSucursal, totales: totalesMes },
    detalle,
    sucursales,
  };
}

async function cargarPorRango(admin: SupabaseClient, desdeIso: string, hastaExcIso: string) {
  type RpcRow = {
    sucursal_id: number;
    nombrefantasia: string | null;
    productos_inventariados?: string | number | null;
    vencidos_cargados: string | number | null;
    vencidos_costo?: string | number | null;
    vencidos_vendidas_unidades: string | number | null;
    inventario_lineas_con_diferencia: string | number | null;
  };

  const { data, error } = await admin.rpc('admin_estadisticas_mensual_sucursal', {
    p_desde: desdeIso,
    p_hasta: hastaExcIso,
  });

  if (error) {
    throw new Error(error.message);
  }

  const filas = (data ?? []) as RpcRow[];

  const inventariadosPorSucursal = rpcIncluyeProductosInventariados(filas)
    ? null
    : await contarProductosInventariadosPorSucursalMes(admin, desdeIso, hastaExcIso);
  const incluyeVencidosCosto = rpcIncluyeVencidosCosto(filas);

  const out: InformeMensualFilaRpc[] = filas
    .map((r) => {
      const sucursal_id = Number(r.sucursal_id);
      const productos_inventariados = inventariadosPorSucursal
        ? (inventariadosPorSucursal.get(sucursal_id) ?? 0)
        : Number(r.productos_inventariados ?? 0);

      return {
        sucursal_id,
        nombrefantasia: String(r.nombrefantasia ?? '').trim() || `Sucursal ${sucursal_id}`,
        productos_inventariados,
        vencidos_cargados: Number(r.vencidos_cargados ?? 0),
        vencidos_costo: incluyeVencidosCosto ? Number(r.vencidos_costo ?? 0) : 0,
        vencidos_vendidas_unidades: Number(r.vencidos_vendidas_unidades ?? 0),
        inventario_lineas_con_diferencia: Number(r.inventario_lineas_con_diferencia ?? 0),
      };
    })
    .filter((r) => esSucursalVisibleEnLogin(r.sucursal_id));

  const totales = out.reduce(
    (acc, r) => ({
      productos_inventariados: acc.productos_inventariados + r.productos_inventariados,
      vencidos_cargados: acc.vencidos_cargados + r.vencidos_cargados,
      vencidos_costo: acc.vencidos_costo + r.vencidos_costo,
      vencidos_vendidas_unidades: acc.vencidos_vendidas_unidades + r.vencidos_vendidas_unidades,
      inventario_lineas_con_diferencia:
        acc.inventario_lineas_con_diferencia + r.inventario_lineas_con_diferencia,
    }),
    {
      productos_inventariados: 0,
      vencidos_cargados: 0,
      vencidos_costo: 0,
      vencidos_vendidas_unidades: 0,
      inventario_lineas_con_diferencia: 0,
    }
  );

  return { filasSucursal: out, totales };
}

export const maxDuration = 120;

/** GET /api/admin/informe-mensual?mes=YYYY-MM&mesesTrend=6 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const guard = await requirePermission('admin.informe_mensual_sucursales');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const mesRaw = searchParams.get('mes')?.trim();
  let year: number;
  let month: number;
  if (mesRaw) {
    const p = parseYm(mesRaw);
    if (!p) {
      return NextResponse.json({ error: 'mes inválido (usar YYYY-MM)' }, { status: 400 });
    }
    year = p.year;
    month = p.month;
    const mesSeleccionYm = `${year}-${String(month).padStart(2, '0')}`;
    const mesActualYm = fechaHoyArgentinaYmd().slice(0, 7);
    if (mesSeleccionYm > mesActualYm) {
      return NextResponse.json(
        { error: 'No se puede consultar un mes posterior al mes actual (Argentina).' },
        { status: 400 }
      );
    }
  } else {
    const hoy = fechaHoyArgentinaYmd();
    const p = parseYm(hoy.slice(0, 7));
    if (!p) {
      return NextResponse.json({ error: 'Fecha servidor inválida' }, { status: 500 });
    }
    year = p.year;
    month = p.month;
  }

  const mesesTrend = Math.min(Math.max(Number(searchParams.get('mesesTrend') ?? '6'), 3), 24);

  const admin = await createAdminClient();

  const mesSeleccionYm = `${year}-${String(month).padStart(2, '0')}`;

  const { data: sucRowsNombres } = await admin.from('sucursales').select('sucursal, nombrefantasia');
  const nombreSucursalById = new Map<number, string>();
  for (const s of sucRowsNombres ?? []) {
    const id = Number((s as { sucursal?: number }).sucursal);
    if (!esSucursalVisibleEnLogin(id)) continue;
    nombreSucursalById.set(
      id,
      String((s as { nombrefantasia?: string | null }).nombrefantasia ?? '').trim() ||
        `Sucursal ${id}`
    );
  }

  const trends: InformeMensualTrendMes[] = [];
  const mesesACargar: { year: number; month: number; ym: string }[] = [];
  {
    let y = year;
    let mo = month;
    for (let i = 0; i < mesesTrend; i++) {
      mesesACargar.push({
        year: y,
        month: mo,
        ym: `${y}-${String(mo).padStart(2, '0')}`,
      });
      const ant = anteriorMesYm(y, mo);
      y = ant.year;
      mo = ant.month;
    }
  }

  let seleccionMes:
    | {
        mes: string;
        filasSucursal: InformeMensualDetalleSucursal[];
        totales: InformeMensualDetalleTotales;
        diferencias_valor: InformeMensualDiferenciasValorMes;
      }
    | undefined;

  type ResultadoMes = {
    ym: string;
    totales: {
      productos_inventariados: number;
      vencidos_cargados: number;
      vencidos_costo: number;
      vencidos_vendidas_unidades: number;
      inventario_lineas_con_diferencia: number;
    };
    diferencias_valor: DiferenciasValorAgregado;
    difValorMap: Map<number, DiferenciasValorAgregado>;
    filasSucursal: InformeMensualFilaRpc[];
  };

  async function cargarMesAgregados(
    y: number,
    mo: number,
    ym: string,
    opts: { conDiferenciasValor: boolean }
  ): Promise<ResultadoMes> {
    const { desdeIso, hastaExclusivoIso } = rangoMedioAbiertoMesArgentinaYm(y, mo);
    if (!desdeIso || !hastaExclusivoIso) {
      throw new Error(`Rango inválido para ${ym}`);
    }
    const { filasSucursal, totales } = await cargarPorRango(admin, desdeIso, hastaExclusivoIso);
    let difValorMap = new Map<number, DiferenciasValorAgregado>();
    let diferencias_valor = { ...DIFERENCIAS_VALOR_CERO };
    if (opts.conDiferenciasValor) {
      difValorMap = await cargarDiferenciasCajasValorPorSucursal(admin, y, mo);
      diferencias_valor = sumarDiferenciasValor(difValorMap.values());
    }
    return { ym, totales, diferencias_valor, difValorMap, filasSucursal };
  }

  try {
    // 1) Mes seleccionado primero (crítico). En serie: evita saturar Postgres
    //    (el paralelismo de varios meses provocaba "statement timeout").
    const mesSelMeta = mesesACargar.find((m) => m.ym === mesSeleccionYm);
    if (!mesSelMeta) {
      return NextResponse.json(
        { error: 'Mes seleccionado fuera del rango de tendencias.' },
        { status: 500 }
      );
    }

    const mesSel = await cargarMesAgregados(mesSelMeta.year, mesSelMeta.month, mesSelMeta.ym, {
      conDiferenciasValor: true,
    });

    let filasDetalle: InformeMensualDetalleSucursal[];
    try {
      filasDetalle = await construirDetalleSucursalInformeMensual(
        admin,
        mesSel.filasSucursal.map((f) => ({
          sucursal_id: f.sucursal_id,
          nombrefantasia: f.nombrefantasia,
          productos_inventariados: f.productos_inventariados,
          vencidos_vendidas_unidades: f.vencidos_vendidas_unidades,
        })),
        year,
        month
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!esTimeoutPostgres(msg)) throw e;
      // Fallback: tabla con datos del RPC; métricas extra en 0.
      filasDetalle = mesSel.filasSucursal.map((f) => ({
        sucursal_id: f.sucursal_id,
        nombrefantasia: f.nombrefantasia,
        productos_inventariados: f.productos_inventariados,
        total_base_trimestre: 0,
        inventariados_padron_trimestre: 0,
        porcentaje_inventariados_sobre_base: 0,
        productos_con_diferencia: 0,
        productos_mal_contados: 0,
        productos_cargados_vencimientos: 0,
        por_vencer_mes: 0,
        productos_vencidos_mes: 0,
        vencidos_costo: f.vencidos_costo,
        unidades_vencidos_vendidas: f.vencidos_vendidas_unidades,
        vales: 0,
        vales_pendientes: 0,
      }));
    }

    const filasDifValor = Array.from(mesSel.difValorMap.entries())
      .map(([sucursal_id, totales]) => ({
        sucursal_id,
        nombrefantasia: nombreSucursalById.get(sucursal_id) ?? `Sucursal ${sucursal_id}`,
        ...normalizarDiferenciasValorAgregado(totales),
      }))
      .filter((f) => f.lineas_con_diferencia > 0 || f.valor_neto !== 0)
      .sort(
        (a, b) =>
          Math.abs(b.valor_neto) - Math.abs(a.valor_neto) ||
          a.nombrefantasia.localeCompare(b.nombrefantasia, 'es')
      );

    seleccionMes = {
      mes: mesSeleccionYm,
      filasSucursal: filasDetalle,
      totales: totalesDetalleInformeMensual(
        filasDetalle,
        mesSel.totales.inventario_lineas_con_diferencia
      ),
      diferencias_valor: {
        filasSucursal: filasDifValor,
        totales: mesSel.diferencias_valor,
      },
    };

    // 2) Resto de meses en serie; timeout en un mes no tumba el informe.
    const porYm = new Map<string, ResultadoMes>([[mesSel.ym, mesSel]]);
    for (const m of mesesACargar) {
      if (m.ym === mesSeleccionYm) continue;
      try {
        const r = await cargarMesAgregados(m.year, m.month, m.ym, {
          conDiferenciasValor: true,
        });
        porYm.set(m.ym, r);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`informe-mensual mes ${m.ym}:`, msg);
        porYm.set(m.ym, {
          ym: m.ym,
          totales: { ...TOTALES_MES_CERO },
          diferencias_valor: { ...DIFERENCIAS_VALOR_CERO },
          difValorMap: new Map(),
          filasSucursal: [],
        });
        if (!esTimeoutPostgres(msg) && !/Error al obtener|could not find function/i.test(msg)) {
          // Otros errores inesperados: seguir con ceros; no abortar.
        }
      }
    }

    // Vales de toda la serie en una sola consulta a Onze, agrupados por mes.
    const mesesOrdenados = [...mesesACargar].reverse();
    const primerMes = mesesOrdenados[0];
    const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1];
    let valesPorMes = new Map<string, { vales: number; vales_pendientes: number }>();
    if (primerMes && ultimoMes) {
      const { fecha_inicio: desdeSerie } = rangoMesCalendarioYm(primerMes.year, primerMes.month);
      const { fecha_fin: finSerie } = rangoMesCalendarioYm(ultimoMes.year, ultimoMes.month);
      const res = await queryValesPorMes(
        [...nombreSucursalById.keys()],
        desdeSerie,
        ymdAddDays(finSerie, 1)
      );
      if (res.ok) valesPorMes = res.data;
      else console.warn('informe mensual (vales tendencia):', res.error);
    }

    for (const m of mesesOrdenados) {
      const r = porYm.get(m.ym);
      const vales = valesPorMes.get(m.ym);
      trends.push({
        mes: m.ym,
        totales: {
          ...(r?.totales ?? { ...TOTALES_MES_CERO }),
          vales: vales?.vales ?? 0,
          vales_pendientes: vales?.vales_pendientes ?? 0,
        },
        diferencias_valor:
          m.ym === mesSeleccionYm
            ? mesSel.diferencias_valor
            : r?.diferencias_valor ?? { ...DIFERENCIAS_VALOR_CERO },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const faltaRpc =
      /function .* does not exist|42883|could not find function|permission denied for function/i.test(
        msg
      );
    const timeout = esTimeoutPostgres(msg);
    return NextResponse.json(
      {
        error: faltaRpc
          ? 'No se pudo ejecutar la función admin_estadisticas_mensual_sucursal en Postgres.'
          : timeout
            ? 'La consulta del informe mensual tardó demasiado (timeout de Postgres).'
            : 'Error al obtener estadísticas mensuales.',
        detalle: msg,
        ayuda: faltaRpc
          ? [
              'En Supabase: SQL Editor → ejecutá las migraciones del informe mensual (004, 009, 011).',
              'Si la función ya existe pero sigue fallando: ejecutá también supabase/migrations/005_admin_informe_mensual_rpc_grants.sql (permisos EXECUTE para service_role).',
            ].join(' ')
          : timeout
            ? 'Probá de nuevo en unos segundos. Si persiste, ejecutá en Supabase la migración 026_admin_informe_mensual_statement_timeout.sql.'
            : undefined,
      },
      { status: 500 }
    );
  }
  if (!seleccionMes) {
    return NextResponse.json({ error: 'Mes seleccionado fuera del rango de tendencias.' }, { status: 500 });
  }

  let bajasStock;
  try {
    bajasStock = await cargarBajasStock(admin, trends, mesSeleccionYm);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    bajasStock = {
      disponible: false as const,
      error: msg,
      trends: [],
      mesSeleccionado: { filasSucursal: [], totales: BAJAS_STOCK_CERO },
      detalle: [],
      sucursales: [],
    };
  }

  return NextResponse.json({
    mesSeleccionado: mesSeleccionYm,
    seleccionMes,
    trends,
    bajasStock,
    leyenda: {
      productos_inventariados:
        'Productos distintos inventariados en controles cerrados del mes (según fecha de cierre). El % es frente a la base del trimestre a recontar (FARMA/BIENESTAR/PSICOTRÓPICOS, sin «Sin padrón»).',
      inventario_diferencias:
        'Líneas de inventario con diferencias en controles cerrados cuya fecha fin cayó en el mes (KPI superior). Con dif. en tabla: productos distintos con diferencia (excluye auditoría); el % es frente a inventariados del mes.',
      productos_mal_contados:
        'Líneas con diferencia en controles de auditoría cerrados en el mes cuyo ajuste sucursal (auditado) tiene el mismo valor en cajas y unidades pero signo opuesto a la diferencia del auditor. El % es frente a «Con dif.» de la sucursal.',
      inventario_diferencias_valor:
        'Valor neteado de diferencias solo en cajas (stock_real_cajas − stock_sist_cajas), en controles cerrados del mes. Por línea: Δ cajas × costo por caja. Se ignoran diferencias en unidades sueltas. Neto = positivo − negativo.',
      productos_cargados_vencimientos:
        'Productos distintos cargados en vencimientos con fecha de registro en el mes.',
      por_vencer_mes:
        'Unidades con fecha de vencimiento dentro del mes calendario seleccionado (sin eliminadas ni devueltas).',
      productos_vencidos_mes:
        'Productos distintos que vencieron en el mes y aún tenían saldo pendiente (sin liquidar del todo).',
      vencidos_costo:
        'Valor en pesos de productos cuya fecha de vencimiento cayó en el mes, con saldo pendiente (cantidad ya netea ventas parciales; excluye vendido=1): SUM(cantidad × costo).',
      vencidos_vendidas_unidades:
        'Unidades marcadas vendidas desde vencimientos (historial ventas por mes según fecha de operación).',
      bajas_stock:
        'Movimientos en onze_center (stockmovimientos) con Referencia «Baja de Stock», por mes y sucursal (excluye sucursales no operativas del login). Cajas/unidades: suma de valores absolutos de Cantidad y Unidades. Valor total: SUM(ABS(Cantidad) × Costo) con Costo de medicamentos (CodPlex = IDProducto).',
    },
  });
}
