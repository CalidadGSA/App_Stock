import type { SupabaseClient } from '@supabase/supabase-js';
import { contarLineasMalContadasAuditoriaPeriodo } from '@/lib/inventario/productos-mal-contados-auditoria';
import {
  contarProductosCargadosVencimientosTrimestre,
  contarProductosConDiferenciaInventarioTrimestre,
  obtenerProgresoPorTrimestreLabel,
} from '@/lib/inventario/trimestre-base';
import {
  inferirCuatrimestreDesdeYmd,
  resolverTrimestreDbPorCalendario,
} from '@/lib/inventario/trimestre-periodo';
import { porcentajeDesdeRatio, ymdAddDays } from '@/lib/utils';
import { queryValesPorSucursal, VALES_VACIO } from '@/lib/legacy-db/mysql-kpis-mensuales';
import {
  cargarProductosConDiferenciaPorSucursal,
  cargarProgresoBasePorSucursal,
  totalesProgresoMacro,
} from '@/lib/inventario/agregados-informes';
import { leerVueltasPsicos } from '@/lib/inventario/generar-base/cantidad-inventario';
import { mapWithConcurrency } from '@/lib/map-with-concurrency';
import { getCostosMedicamentosOnze } from '@/lib/legacy-db/onze-medicamentos';

export type MetricasVencimientosInformeMensual = {
  productos_cargados_vencimientos: number;
  por_vencer_mes: number;
  productos_vencidos_mes: number;
  vencidos_costo: number;
};

export type InformeMensualDetalleSucursal = {
  sucursal_id: number;
  nombrefantasia: string;
  /**
   * Productos distintos inventariados en controles cerrados del mes (fecha_fin en el mes).
   * Viene del RPC / conteo mensual; no es el avance de padrón del trimestre.
   */
  productos_inventariados: number;
  /** Base total de productos del trimestre al que pertenece el mes (base_productos). */
  total_base_trimestre: number;
  /**
   * Avance del padrón del trimestre (vecesinventariado &gt; 0), mismo criterio que el dashboard.
   */
  inventariados_padron_trimestre: number;
  /**
   * Avance del padrón: inventariados_padron_trimestre / total_base_trimestre.
   */
  porcentaje_inventariados_sobre_base: number;
  /** Productos distintos con diferencia en el mes (sin auditoría). */
  productos_con_diferencia: number;
  /** Líneas con diferencia en auditoría y ajuste sucursal inverso al auditor. */
  productos_mal_contados: number;
  productos_cargados_vencimientos: number;
  por_vencer_mes: number;
  productos_vencidos_mes: number;
  vencidos_costo: number;
  unidades_vencidos_vendidas: number;
  /** Vales (comprobantes con productos pendientes de entrega) generados en el mes. */
  vales: number;
  /** De esos vales, los que todavía tienen algún producto sin entregar. */
  vales_pendientes: number;
};

export type InformeMensualDetalleTotales = Omit<
  InformeMensualDetalleSucursal,
  'sucursal_id' | 'nombrefantasia'
> & {
  /** Líneas con diferencia (suma por sucursal, mismo criterio que RPC / KPI). */
  inventario_lineas_con_diferencia: number;
};

const DETALLE_VENC_CHUNK = 1000;

export function rangoMesCalendarioYm(
  year: number,
  month1_12: number
): { fecha_inicio: string; fecha_fin: string } {
  const lastDay = new Date(year, month1_12, 0).getDate();
  const m = String(month1_12).padStart(2, '0');
  return {
    fecha_inicio: `${year}-${m}-01`,
    fecha_fin: `${year}-${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Unidades con fecha de vencimiento dentro del mes calendario. */
async function contarPorVencerEnMes(
  admin: SupabaseClient,
  sucId: number,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select('cantidad, controles_vencimientos!inner(sucursal_id)')
    .eq('controles_vencimientos.sucursal_id', sucId)
    .gte('fecha_vencimiento', fechaInicio)
    .lte('fecha_vencimiento', fechaFin)
    .eq('eliminado', 0)
    .eq('devuelto', 0);

  if (error) {
    console.error('contarPorVencerEnMes:', error.message);
    return 0;
  }

  let total = 0;
  for (const r of data ?? []) {
    const q = Number((r as { cantidad?: number | null }).cantidad ?? 0);
    if (Number.isFinite(q) && q > 0) total += q;
  }
  return Math.round(total);
}

async function metricasVencidosEnMes(
  admin: SupabaseClient,
  sucId: number,
  fechaInicio: string,
  fechaFin: string
): Promise<{ productos_vencidos_mes: number; vencidos_costo: number }> {
  const productos = new Set<string>();
  let costo = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'producto_id_sistema, cantidad, vendido, controles_vencimientos!inner(sucursal_id)'
      )
      .eq('controles_vencimientos.sucursal_id', sucId)
      .gte('fecha_vencimiento', fechaInicio)
      .lte('fecha_vencimiento', fechaFin)
      .eq('eliminado', 0)
      .order('id', { ascending: true })
      .range(offset, offset + DETALLE_VENC_CHUNK - 1);

    if (error) {
      console.error('metricasVencidosEnMes:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    const codplexList = batch
      .map((r) => String((r as { producto_id_sistema?: string }).producto_id_sistema ?? '').trim())
      .filter(Boolean);
    const costoByCodplex = await costosMedicamentosPorCodplex(admin, codplexList);

    for (const row of batch) {
      const raw = row as {
        producto_id_sistema?: string;
        cantidad?: number | null;
        vendido?: number | null;
      };
      if (Number(raw.vendido ?? 0) === 1) continue;
      const cant = Number(raw.cantidad ?? 0);
      if (!Number.isFinite(cant) || cant <= 0) continue;

      const pid = String(raw.producto_id_sistema ?? '').trim();
      if (pid) productos.add(pid);
      costo += cant * (costoByCodplex.get(pid) ?? 0);
    }

    if (batch.length < DETALLE_VENC_CHUNK) break;
    offset += DETALLE_VENC_CHUNK;
  }

  return { productos_vencidos_mes: productos.size, vencidos_costo: costo };
}

/**
 * Costo por caja de cada producto, desde `onze_center.medicamentos` en vivo:
 * se usa `Costo` y, si no hay, `Precio × 0,65` (ver `getCostosMedicamentosOnze`).
 */
export async function costosMedicamentosPorCodplex(
  _admin: SupabaseClient,
  codplexTextos: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(codplexTextos)];
  if (ids.length === 0) return map;

  const numericos = ids.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  if (numericos.length === 0) return map;

  const { costos } = await getCostosMedicamentosOnze(numericos);
  for (const [id, costo] of costos) map.set(id, costo);
  return map;
}

export async function cargarMetricasVencimientosInformeMensual(
  admin: SupabaseClient,
  sucId: number,
  year: number,
  month1_12: number
): Promise<MetricasVencimientosInformeMensual> {
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month1_12);

  const [productos_cargados_vencimientos, por_vencer_mes, vencidos] = await Promise.all([
    contarProductosCargadosVencimientosTrimestre(
      admin,
      sucId,
      fecha_inicio,
      fecha_fin
    ),
    contarPorVencerEnMes(admin, sucId, fecha_inicio, fecha_fin),
    metricasVencidosEnMes(admin, sucId, fecha_inicio, fecha_fin),
  ]);

  return {
    productos_cargados_vencimientos,
    por_vencer_mes,
    productos_vencidos_mes: vencidos.productos_vencidos_mes,
    vencidos_costo: vencidos.vencidos_costo,
  };
}

type RpcFilaBase = {
  sucursal_id: number;
  nombrefantasia: string;
  productos_inventariados: number;
  vencidos_vendidas_unidades: number;
};

export async function construirDetalleSucursalInformeMensual(
  admin: SupabaseClient,
  filasRpc: RpcFilaBase[],
  year: number,
  month1_12: number
): Promise<InformeMensualDetalleSucursal[]> {
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month1_12);

  // Una sola consulta a Onze para todas las sucursales. Si no responde, los vales van en 0.
  const valesRes = await queryValesPorSucursal(
    filasRpc.map((r) => r.sucursal_id),
    fecha_inicio,
    ymdAddDays(fecha_fin, 1)
  );
  if (!valesRes.ok) console.warn('informe mensual (vales):', valesRes.error);
  const valesPorSucursal = valesRes.ok ? valesRes.data : new Map<number, typeof VALES_VACIO>();

  const inf = inferirCuatrimestreDesdeYmd(fecha_inicio);
  const periodo =
    inf != null ? await resolverTrimestreDbPorCalendario(admin, inf.anio, inf.cuatrimestre) : null;

  // Agregados de Postgres para todas las sucursales de una (migración 030). Sin ella, null.
  const vueltasPsicos = await leerVueltasPsicos(
    admin,
    filasRpc.map((r) => r.sucursal_id)
  );
  const [progresoPorSucursal, difPorSucursal] = await Promise.all([
    periodo
      ? cargarProgresoBasePorSucursal(admin, periodo.trimestre, vueltasPsicos)
      : Promise.resolve(null),
    cargarProductosConDiferenciaPorSucursal(admin, fecha_inicio, fecha_fin),
  ]);

  return mapWithConcurrency(filasRpc, 4, async (r) => {
    const porMacroAgregado = progresoPorSucursal?.get(r.sucursal_id);
    const progreso = porMacroAgregado
      ? {
          ...totalesProgresoMacro(porMacroAgregado),
          trimestre: periodo?.trimestre ?? '',
          fecha_inicio: periodo?.fecha_inicio ?? '',
          fecha_fin: periodo?.fecha_fin ?? '',
        }
      : periodo
      ? await obtenerProgresoPorTrimestreLabel(
          admin,
          r.sucursal_id,
          periodo.trimestre,
          periodo.fecha_inicio,
          periodo.fecha_fin
        )
      : {
          total: 0,
          inventariados: 0,
          pendientes: 0,
          porcentaje: 0,
          trimestre: '',
          fecha_inicio: '',
          fecha_fin: '',
        };

    const totalBase = progreso.total;
    const inventariadosPadron = progreso.inventariados;
    const pctSobreBase = porcentajeDesdeRatio(inventariadosPadron, totalBase);

    const [productos_con_diferencia, productos_mal_contados, venc] = await Promise.all([
      difPorSucursal
        ? Promise.resolve(difPorSucursal.get(r.sucursal_id) ?? 0)
        : contarProductosConDiferenciaInventarioTrimestre(
            admin,
            r.sucursal_id,
            fecha_inicio,
            fecha_fin
          ),
      contarLineasMalContadasAuditoriaPeriodo(
        admin,
        fecha_inicio,
        fecha_fin,
        r.sucursal_id
      ),
      cargarMetricasVencimientosInformeMensual(admin, r.sucursal_id, year, month1_12),
    ]);

    return {
      sucursal_id: r.sucursal_id,
      nombrefantasia: r.nombrefantasia,
      // Conteo mensual (RPC): productos distintos en controles cerrados del mes.
      productos_inventariados: Number(r.productos_inventariados ?? 0),
      total_base_trimestre: totalBase,
      inventariados_padron_trimestre: inventariadosPadron,
      porcentaje_inventariados_sobre_base: pctSobreBase,
      productos_con_diferencia,
      productos_mal_contados,
      productos_cargados_vencimientos: venc.productos_cargados_vencimientos,
      por_vencer_mes: venc.por_vencer_mes,
      productos_vencidos_mes: venc.productos_vencidos_mes,
      vencidos_costo: venc.vencidos_costo,
      unidades_vencidos_vendidas: Number(r.vencidos_vendidas_unidades),
      vales: (valesPorSucursal.get(r.sucursal_id) ?? VALES_VACIO).vales,
      vales_pendientes: (valesPorSucursal.get(r.sucursal_id) ?? VALES_VACIO).vales_pendientes,
    };
  });
}

export function totalesDetalleInformeMensual(
  filas: InformeMensualDetalleSucursal[],
  inventarioLineasConDiferencia: number
): InformeMensualDetalleTotales {
  const base = filas.reduce(
    (acc, f) => ({
      productos_inventariados: acc.productos_inventariados + f.productos_inventariados,
      total_base_trimestre: acc.total_base_trimestre + f.total_base_trimestre,
      inventariados_padron_trimestre:
        acc.inventariados_padron_trimestre + f.inventariados_padron_trimestre,
      porcentaje_inventariados_sobre_base: 0,
      productos_con_diferencia: acc.productos_con_diferencia + f.productos_con_diferencia,
      productos_mal_contados: acc.productos_mal_contados + f.productos_mal_contados,
      productos_cargados_vencimientos:
        acc.productos_cargados_vencimientos + f.productos_cargados_vencimientos,
      por_vencer_mes: acc.por_vencer_mes + f.por_vencer_mes,
      productos_vencidos_mes: acc.productos_vencidos_mes + f.productos_vencidos_mes,
      vencidos_costo: acc.vencidos_costo + f.vencidos_costo,
      unidades_vencidos_vendidas:
        acc.unidades_vencidos_vendidas + f.unidades_vencidos_vendidas,
      vales: acc.vales + f.vales,
      vales_pendientes: acc.vales_pendientes + f.vales_pendientes,
    }),
    {
      productos_inventariados: 0,
      total_base_trimestre: 0,
      inventariados_padron_trimestre: 0,
      porcentaje_inventariados_sobre_base: 0,
      productos_con_diferencia: 0,
      productos_mal_contados: 0,
      productos_cargados_vencimientos: 0,
      por_vencer_mes: 0,
      productos_vencidos_mes: 0,
      vencidos_costo: 0,
      unidades_vencidos_vendidas: 0,
      vales: 0,
      vales_pendientes: 0,
    }
  );

  return {
    ...base,
    porcentaje_inventariados_sobre_base: porcentajeDesdeRatio(
      base.inventariados_padron_trimestre,
      base.total_base_trimestre
    ),
    inventario_lineas_con_diferencia: inventarioLineasConDiferencia,
  };
}
