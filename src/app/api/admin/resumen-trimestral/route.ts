import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import { fechaHoyArgentinaYmd, porcentajeDesdeRatio } from '@/lib/utils';
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
}

export interface ResumenTrimestralSeleccion {
  anio: number;
  cuatrimestre: Cuatrimestre;
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  etiqueta: string;
}

/** GET /api/admin/resumen-trimestral?anio=2026&cuatrimestre=1 */
export async function GET(request: NextRequest) {
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

  const filas: ResumenTrimestralSucursalRow[] = (
    await Promise.all(
      sucursales.map(async (s) => {
        const sucId = Number(s.sucursal);

        const progreso =
          anioParam != null && cuatrimestreParam != null
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
            contarProductosConDiferenciaInventarioTrimestre(
              admin,
              sucId,
              periodo!.fecha_inicio,
              periodo!.fecha_fin
            ),
            contarLineasMalContadasAuditoriaPeriodo(
              admin,
              periodo!.fecha_inicio,
              periodo!.fecha_fin,
              sucId
            ),
            obtenerMetricasVencidosStock(admin, sucId, hoyVen),
            contarProductosCargadosVencimientosTrimestre(
              admin,
              sucId,
              periodo!.fecha_inicio,
              periodo!.fecha_fin
            ),
            contarVentanasPorVencerEnTrimestre(
              admin,
              sucId,
              // Siempre la fecha real de hoy: si el trimestre ya cerró,
              // la función devuelve 0 (no tiene sentido “próximos 30 días”).
              hoyVen,
              periodo!.fecha_fin
            ),
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
        };
      })
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
    }
  );

  const porcentajeGlobal = porcentajeDesdeRatio(totales.inventariados, totales.total);

  const [metricasVencidosGlobal, inventariadosAuditoriaGlobal, diferenciasAuditoriaGlobal, malContadosGlobal] =
    await Promise.all([
      obtenerMetricasVencidosStockGlobal(admin, hoyVen),
      contarProductosInventariadosAuditoriaTrimestreGlobal(
        admin,
        seleccion.fecha_inicio,
        seleccion.fecha_fin
      ),
      contarProductosConDiferenciaAuditoriaTrimestreGlobal(
        admin,
        seleccion.fecha_inicio,
        seleccion.fecha_fin
      ),
      contarLineasMalContadasAuditoriaPeriodo(
        admin,
        seleccion.fecha_inicio,
        seleccion.fecha_fin
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
