import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  fechaHoyArgentinaYmd,
  parseYm,
  anteriorMesYm,
  rangoMedioAbiertoMesArgentinaYm,
} from '@/lib/utils';
import { queryBajasStockAgregado } from '@/lib/legacy-db/mysql-bajas-stock';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import {
  construirDetalleSucursalInformeMensual,
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

  const { desdeIso } = rangoMedioAbiertoMesArgentinaYm(p0.year, p0.month);
  const { hastaExclusivoIso } = rangoMedioAbiertoMesArgentinaYm(p1.year, p1.month);
  if (!desdeIso || !hastaExclusivoIso) {
    return {
      disponible: false,
      error: 'Rango de fechas inválido',
      trends: [],
      mesSeleccionado: { filasSucursal: [], totales: BAJAS_STOCK_CERO },
      detalle: [],
      sucursales: [],
    };
  }

  const query = await queryBajasStockAgregado(desdeIso, hastaExclusivoIso);
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
  let seleccionMes:
    | {
        mes: string;
        filasSucursal: InformeMensualDetalleSucursal[];
        totales: InformeMensualDetalleTotales;
        diferencias_valor: InformeMensualDiferenciasValorMes;
      }
    | undefined;

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
  let y = year;
  let mo = month;

  for (let i = 0; i < mesesTrend; i++) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`;
    const { desdeIso, hastaExclusivoIso } = rangoMedioAbiertoMesArgentinaYm(y, mo);
    if (!desdeIso || !hastaExclusivoIso) break;
    try {
      const { filasSucursal, totales } = await cargarPorRango(admin, desdeIso, hastaExclusivoIso);
      const difValorMap = await cargarDiferenciasCajasValorPorSucursal(admin, y, mo);
      const diferencias_valor = sumarDiferenciasValor(difValorMap.values());
      trends.push({ mes: ym, totales, diferencias_valor });
      if (ym === mesSeleccionYm) {
        const filasDetalle = await construirDetalleSucursalInformeMensual(
          admin,
          filasSucursal.map((f) => ({
            sucursal_id: f.sucursal_id,
            nombrefantasia: f.nombrefantasia,
            productos_inventariados: f.productos_inventariados,
            vencidos_vendidas_unidades: f.vencidos_vendidas_unidades,
          })),
          year,
          month
        );
        const filasDifValor = Array.from(difValorMap.entries())
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
            totales.inventario_lineas_con_diferencia
          ),
          diferencias_valor: {
            filasSucursal: filasDifValor,
            totales: diferencias_valor,
          },
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const faltaRpc =
        /function .* does not exist|42883|could not find function|permission denied for function/i.test(
          msg
        );
      return NextResponse.json(
        {
          error: faltaRpc
            ? 'No se pudo ejecutar la función admin_estadisticas_mensual_sucursal en Postgres.'
            : 'Error al obtener estadísticas mensuales.',
          detalle: msg,
          ayuda: faltaRpc
            ? [
                'En Supabase: SQL Editor → ejecutá las migraciones del informe mensual (004, 009, 011).',
                'Si la función ya existe pero sigue fallando: ejecutá también supabase/migrations/005_admin_informe_mensual_rpc_grants.sql (permisos EXECUTE para service_role).',
              ].join(' ')
            : undefined,
        },
        { status: 500 }
      );
    }
    const ant = anteriorMesYm(y, mo);
    y = ant.year;
    mo = ant.month;
  }

  trends.reverse();

  if (!seleccionMes) {
    return NextResponse.json({ error: 'Mes seleccionado fuera del rango de tendencias.' }, { status: 500 });
  }

  const bajasStock = await cargarBajasStock(admin, trends, mesSeleccionYm);

  return NextResponse.json({
    mesSeleccionado: mesSeleccionYm,
    seleccionMes,
    trends,
    bajasStock,
    leyenda: {
      productos_inventariados:
        'Productos distintos inventariados en el mes (fecha fin del control). Entre paréntesis: % sobre la base total del trimestre (base_productos).',
      inventario_diferencias:
        'Líneas de inventario con diferencias en controles cerrados cuya fecha fin cayó en el mes (KPI superior). Con dif. en tabla: productos distintos con diferencia (excluye auditoría).',
      productos_mal_contados:
        'Líneas con diferencia en controles de auditoría cerrados en el mes cuyo ajuste sucursal (auditado) tiene el mismo valor en cajas y unidades pero signo opuesto a la diferencia del auditor.',
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
