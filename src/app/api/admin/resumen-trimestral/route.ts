import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import { fechaHoyArgentinaYmd, porcentajeDesdeRatio, ymdAddDays } from '@/lib/utils';
import { queryValesPorSucursal, VALES_VACIO } from '@/lib/legacy-db/mysql-kpis-mensuales';
import {
  cargarProductosConDiferenciaPorSucursal,
  cargarProgresoBasePorSucursal,
  totalesProgresoMacro,
} from '@/lib/inventario/agregados-informes';
import { leerVueltasPsicos } from '@/lib/inventario/generar-base/cantidad-inventario';
import { contarLineasMalContadasAuditoriaPeriodo } from '@/lib/inventario/productos-mal-contados-auditoria';
import {
  contarProductosCargadosVencimientosTrimestre,
  contarProductosConDiferenciaInventarioTrimestre,
  contarProductosConDiferenciaAuditoriaTrimestreGlobal,
  contarProductosInventariadosAuditoriaTrimestreGlobal,
  obtenerMetricasVencidosStock,
  obtenerMetricasVencidosStockGlobal,
  contarVentanasPorVencerEnTrimestre,
  obtenerProgresoPorTrimestreLabel,
  obtenerProgresoTrimestreSucursal,
} from '@/lib/inventario/trimestre-base';
import {
  type Cuatrimestre,
  type TrimestreDbOpcion,
  cuatrimestreActualDesdeHoy,
  etiquetaCuatrimestre,
  fechaCorteResumenTrimestre,
  listarTrimestresEnBase,
  parseAnioQuery,
  parseCuatrimestreQuery,
  resolverTrimestreDbPorCalendario,
  resolverTrimestreVigente,
} from '@/lib/inventario/trimestre-periodo';
import {
  esSucursalVisibleEnLogin,
  filtrarSucursalesVisiblesLogin,
  filtroSucursalesExcluidasLogin,
} from '@/lib/sucursales/login-sucursales';
import { mapWithConcurrency } from '@/lib/map-with-concurrency';
import { NextRequest, NextResponse } from 'next/server';

export interface ResumenTrimestralSucursalRow {
  sucursal_id: number;
  sucursal_nombre: string;
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  inventariados: number;
  pendientes: number;
  total: number;
  porcentaje: number;
  productos_con_diferencia: number;
  /** Líneas con diferencia en auditoría y ajuste sucursal inverso al auditor. */
  productos_mal_contados: number;
  por_vencer_trimestre: number;
  por_vencer_30_dias: number;
  por_vencer_31_60_dias: number;
  por_vencer_61_90_dias: number;
  /** Productos distintos vencidos con saldo (fecha_venc. &lt; hoy, no liquidado del todo). */
  productos_vencidos_trimestre: number;
  /** Unidades vendidas de stock vencido (vencimientos_detalle_ventas, venc. &lt; hoy). */
  unidades_vencidos_vendidas: number;
  /** Productos distintos cargados en vencimientos (fecha_registro en trimestre). */
  productos_cargados_vencimientos: number;
  /** @deprecated Mantener compatibilidad; usar productos_vencidos_trimestre. */
  vencidos_cargados_unidades: number;
  /** Vales (comprobantes con productos pendientes de entrega) generados en el trimestre. */
  vales: number;
  /** De esos vales, los que todavía tienen algún producto sin entregar. */
  vales_pendientes: number;
}

export interface ResumenTrimestralSeleccion {
  anio: number;
  cuatrimestre: Cuatrimestre;
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  etiqueta: string;
}

export const maxDuration = 120;

/**
 * Cuántas sucursales se procesan en paralelo.
 *
 * Con los agregados de la migración 030 lo que queda por sucursal son consultas livianas y 6 en
 * paralelo no da problemas (medido). Sin la migración, las dos consultas pesadas compiten entre
 * sí y a partir de 3 empiezan a chocar contra el statement timeout de Postgres.
 */
const RESUMEN_SUCURSAL_CONCURRENCY = 3;
const RESUMEN_SUCURSAL_CONCURRENCY_AGREGADOS = 6;

async function safeNumber(fn: () => Promise<number>, label: string): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[resumen-trimestral] ${label}:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/** GET /api/admin/resumen-trimestral?anio=2026&cuatrimestre=1 */
export async function GET(request: NextRequest) {
  try {
    return await getResumenTrimestral(request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[resumen-trimestral] fatal:', msg);
    return NextResponse.json(
      {
        error: /statement timeout|canceling statement|57014/i.test(msg)
          ? 'La consulta del resumen trimestral tardó demasiado (timeout de Postgres). Probá de nuevo.'
          : 'Error al cargar el resumen trimestral.',
        detalle: msg,
      },
      { status: 500 }
    );
  }
}

async function getResumenTrimestral(request: NextRequest) {
  const guard = await requirePermission('admin.resumen_trimestral');
  if (!guard.ok) return guard.response;

  const admin = await createAdminClient();
  const hoyVen = fechaHoyArgentinaYmd();
  const { searchParams } = new URL(request.url);

  const anioParam = parseAnioQuery(searchParams.get('anio'));
  const cuatrimestreParam = parseCuatrimestreQuery(searchParams.get('cuatrimestre'));

  let periodo: TrimestreDbOpcion | null = null;

  if (anioParam != null && cuatrimestreParam != null) {
    periodo = await resolverTrimestreDbPorCalendario(admin, anioParam, cuatrimestreParam);
  } else {
    periodo = await resolverTrimestreVigente(admin, hoyVen);
  }

  if (!periodo) {
    const actual = cuatrimestreActualDesdeHoy(hoyVen);
    periodo = {
      trimestre: etiquetaCuatrimestre(actual.anio, actual.cuatrimestre),
      fecha_inicio: actual.fecha_inicio,
      fecha_fin: actual.fecha_fin,
      anio: actual.anio,
      cuatrimestre: actual.cuatrimestre,
    };
  }

  const fechaCorte = fechaCorteResumenTrimestre(
    hoyVen,
    periodo.fecha_inicio,
    periodo.fecha_fin
  );

  const seleccion: ResumenTrimestralSeleccion = {
    anio: periodo.anio,
    cuatrimestre: periodo.cuatrimestre,
    trimestre: periodo.trimestre,
    fecha_inicio: periodo.fecha_inicio,
    fecha_fin: periodo.fecha_fin,
    etiqueta: etiquetaCuatrimestre(periodo.anio, periodo.cuatrimestre),
  };

  const opciones_trimestre = await listarTrimestresEnBase(admin);

  const { data: sucursalesRows, error: errSuc } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .eq('activa', true)
    .not('sucursal', 'in', filtroSucursalesExcluidasLogin())
    .order('nombrefantasia');

  if (errSuc) {
    return NextResponse.json({ error: errSuc.message }, { status: 500 });
  }

  const sucursales = filtrarSucursalesVisiblesLogin(
    (sucursalesRows ?? []) as Array<{
      sucursal: number;
      nombrefantasia: string | null;
    }>
  );

  const sucursalIds = sucursales.map((s) => Number(s.sucursal));

  // Agregados de Postgres: una llamada para todas las sucursales en vez de una por sucursal.
  // Si la migración 030 no está aplicada, vuelven null y se usa el camino de siempre.
  const vueltasPsicos = await leerVueltasPsicos(admin, sucursalIds);
  const [progresoPorSucursal, difPorSucursal] = await Promise.all([
    cargarProgresoBasePorSucursal(admin, periodo!.trimestre, vueltasPsicos),
    cargarProductosConDiferenciaPorSucursal(admin, periodo!.fecha_inicio, periodo!.fecha_fin),
  ]);

  // Una sola consulta a Onze para todas las sucursales del trimestre.
  const valesRes = await queryValesPorSucursal(
    sucursales.map((s) => Number(s.sucursal)),
    periodo!.fecha_inicio,
    ymdAddDays(periodo!.fecha_fin, 1)
  );
  if (!valesRes.ok) console.warn('[resumen-trimestral] vales:', valesRes.error);
  const valesPorSucursal = valesRes.ok ? valesRes.data : new Map<number, typeof VALES_VACIO>();

  const filas: ResumenTrimestralSucursalRow[] = (
    await mapWithConcurrency(
      sucursales,
      progresoPorSucursal && difPorSucursal
        ? RESUMEN_SUCURSAL_CONCURRENCY_AGREGADOS
        : RESUMEN_SUCURSAL_CONCURRENCY,
      async (s) => {
        const sucId = Number(s.sucursal);

        const porMacroAgregado = progresoPorSucursal?.get(sucId);
        const progreso = porMacroAgregado
          ? {
              ...totalesProgresoMacro(porMacroAgregado),
              trimestre: periodo!.trimestre,
              fecha_inicio: periodo!.fecha_inicio,
              fecha_fin: periodo!.fecha_fin,
              por_macro: porMacroAgregado,
            }
          : anioParam != null && cuatrimestreParam != null
            ? await obtenerProgresoPorTrimestreLabel(
                admin,
                sucId,
                periodo!.trimestre,
                periodo!.fecha_inicio,
                periodo!.fecha_fin
              )
            : await obtenerProgresoTrimestreSucursal(admin, sucId, hoyVen);

        const [productosDif, productosMalContados, metricasVenc, productosCargadosVenc, ventanas] =
          await Promise.all([
            difPorSucursal
              ? Promise.resolve(difPorSucursal.get(sucId) ?? 0)
              : safeNumber(
                  () =>
                    contarProductosConDiferenciaInventarioTrimestre(
                      admin,
                      sucId,
                      periodo!.fecha_inicio,
                      periodo!.fecha_fin
                    ),
                  `dif suc=${sucId}`
                ),
            safeNumber(
              () =>
                contarLineasMalContadasAuditoriaPeriodo(
                  admin,
                  periodo!.fecha_inicio,
                  periodo!.fecha_fin,
                  sucId
                ),
              `malContados suc=${sucId}`
            ),
            obtenerMetricasVencidosStock(admin, sucId, hoyVen).catch((e) => {
              console.error(`[resumen-trimestral] vencidos suc=${sucId}:`, e);
              return { productos_con_saldo: 0, unidades_vendidas: 0 };
            }),
            safeNumber(
              () =>
                contarProductosCargadosVencimientosTrimestre(
                  admin,
                  sucId,
                  periodo!.fecha_inicio,
                  periodo!.fecha_fin
                ),
              `cargadosVenc suc=${sucId}`
            ),
            contarVentanasPorVencerEnTrimestre(
              admin,
              sucId,
              // Siempre la fecha real de hoy: si el trimestre ya cerró,
              // la función devuelve 0 (no tiene sentido “próximos 30 días”).
              hoyVen,
              periodo!.fecha_fin
            ).catch((e) => {
              console.error(`[resumen-trimestral] porVencer suc=${sucId}:`, e);
              return {
                total_trimestre: 0,
                por_vencer_primeros_30: 0,
                por_vencer_31_a_60: 0,
                por_vencer_61_a_90: 0,
              };
            }),
          ]);

        return {
          sucursal_id: sucId,
          sucursal_nombre: String(s.nombrefantasia ?? sucId),
          trimestre: progreso.trimestre || periodo!.trimestre,
          fecha_inicio: progreso.fecha_inicio || periodo!.fecha_inicio,
          fecha_fin: progreso.fecha_fin || periodo!.fecha_fin,
          inventariados: progreso.inventariados,
          pendientes: progreso.pendientes,
          total: progreso.total,
          porcentaje: progreso.porcentaje,
          productos_con_diferencia: productosDif,
          productos_mal_contados: productosMalContados,
          por_vencer_trimestre: ventanas.total_trimestre,
          por_vencer_30_dias: ventanas.por_vencer_primeros_30,
          por_vencer_31_60_dias: ventanas.por_vencer_31_a_60,
          por_vencer_61_90_dias: ventanas.por_vencer_61_a_90,
          productos_vencidos_trimestre: metricasVenc.productos_con_saldo,
          unidades_vencidos_vendidas: metricasVenc.unidades_vendidas,
          productos_cargados_vencimientos: productosCargadosVenc,
          vencidos_cargados_unidades: metricasVenc.productos_con_saldo,
          vales: (valesPorSucursal.get(sucId) ?? VALES_VACIO).vales,
          vales_pendientes: (valesPorSucursal.get(sucId) ?? VALES_VACIO).vales_pendientes,
        };
      }
    )
  ).filter((f) => esSucursalVisibleEnLogin(f.sucursal_id));

  filas.sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es'));

  const totales = filas.reduce(
    (acc, f) => ({
      inventariados: acc.inventariados + f.inventariados,
      pendientes: acc.pendientes + f.pendientes,
      total: acc.total + f.total,
      productos_con_diferencia: acc.productos_con_diferencia + f.productos_con_diferencia,
      productos_mal_contados: acc.productos_mal_contados + f.productos_mal_contados,
      por_vencer_trimestre: acc.por_vencer_trimestre + f.por_vencer_trimestre,
      por_vencer_30_dias: acc.por_vencer_30_dias + f.por_vencer_30_dias,
      por_vencer_31_60_dias: acc.por_vencer_31_60_dias + f.por_vencer_31_60_dias,
      por_vencer_61_90_dias: acc.por_vencer_61_90_dias + f.por_vencer_61_90_dias,
      productos_vencidos_trimestre:
        acc.productos_vencidos_trimestre + f.productos_vencidos_trimestre,
      unidades_vencidos_vendidas:
        acc.unidades_vencidos_vendidas + f.unidades_vencidos_vendidas,
      productos_cargados_vencimientos:
        acc.productos_cargados_vencimientos + f.productos_cargados_vencimientos,
      vales: acc.vales + f.vales,
      vales_pendientes: acc.vales_pendientes + f.vales_pendientes,
    }),
    {
      inventariados: 0,
      pendientes: 0,
      total: 0,
      productos_con_diferencia: 0,
      productos_mal_contados: 0,
      por_vencer_trimestre: 0,
      por_vencer_30_dias: 0,
      por_vencer_31_60_dias: 0,
      por_vencer_61_90_dias: 0,
      productos_vencidos_trimestre: 0,
      unidades_vencidos_vendidas: 0,
      productos_cargados_vencimientos: 0,
      vales: 0,
      vales_pendientes: 0,
    }
  );

  const porcentajeGlobal = porcentajeDesdeRatio(totales.inventariados, totales.total);

  // Mal contados: usar suma por sucursal (ya calculada). El conteo global
  // sin filtro re-escanea todo el trimestre y suma ~10–70s de latencia.
  const malContadosGlobal = totales.productos_mal_contados;

  const [metricasVencidosGlobal, inventariadosAuditoriaGlobal, diferenciasAuditoriaGlobal] =
    await Promise.all([
      obtenerMetricasVencidosStockGlobal(admin, hoyVen).catch((e) => {
        console.error('[resumen-trimestral] vencidosGlobal:', e);
        return { productos_con_saldo: 0, unidades_vendidas: 0 };
      }),
      safeNumber(
        () =>
          contarProductosInventariadosAuditoriaTrimestreGlobal(
            admin,
            seleccion.fecha_inicio,
            seleccion.fecha_fin
          ),
        'invAudGlobal'
      ),
      safeNumber(
        () =>
          contarProductosConDiferenciaAuditoriaTrimestreGlobal(
            admin,
            seleccion.fecha_inicio,
            seleccion.fecha_fin
          ),
        'difAudGlobal'
      ),
    ]);

  /** Suma por sucursal (mismo criterio que la tabla); el conteo global distinto suele ser menor. */
  const porcentajeDiferenciasGlobal = porcentajeDesdeRatio(
    totales.productos_con_diferencia,
    totales.inventariados
  );

  const porcentajeDiferenciasAuditoriaGlobal = porcentajeDesdeRatio(
    diferenciasAuditoriaGlobal,
    inventariadosAuditoriaGlobal
  );

  return NextResponse.json({
    data: {
      hoy: hoyVen,
      fecha_corte: fechaCorte,
      trimestre: seleccion.trimestre,
      seleccion,
      opciones_trimestre,
      fecha_inicio: seleccion.fecha_inicio,
      fecha_fin: seleccion.fecha_fin,
      totales: {
        ...totales,
        productos_con_diferencia_global: totales.productos_con_diferencia,
        productos_inventariados_auditoria_global: inventariadosAuditoriaGlobal,
        productos_con_diferencia_auditoria_global: diferenciasAuditoriaGlobal,
        productos_mal_contados: totales.productos_mal_contados,
        productos_mal_contados_global: malContadosGlobal,
        productos_vencidos_trimestre_global: metricasVencidosGlobal.productos_con_saldo,
        unidades_vencidos_vendidas_global: metricasVencidosGlobal.unidades_vendidas,
        porcentaje: porcentajeGlobal,
        porcentaje_diferencias: porcentajeDiferenciasGlobal,
        porcentaje_diferencias_auditoria: porcentajeDiferenciasAuditoriaGlobal,
      },
      sucursales: filas,
    },
  });
}
