/**
 * Tablero mensual de todas las sucursales en una sola pantalla.
 *
 * Reúne, por sucursal y para un mes:
 *  - avance de inventario real vs esperado (días hábiles transcurridos del trimestre);
 *  - faltantes a costo y su peso sobre el **stock efectivamente controlado**, que es el
 *    denominador correcto: comparar contra el stock total subestima el desvío cuando se
 *    controló poco. Se muestra también sobre el stock total, para comparar con el histórico;
 *  - bajas de pérdida efectiva a PVP sobre la facturación neta;
 *  - vales generados.
 *
 * Todo sale de consultas por lote: una llamada por fuente, no una por sucursal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rangoFechasArgentinaIso, ymdAddDays } from '@/lib/utils';
import { rangoMesCalendarioYm } from '@/lib/inventario/informe-mensual-metricas';
import { contarDiasHabiles } from '@/lib/fechas/feriados-argentina';
import { trimestreDelMes } from '@/lib/kpis/avance-inventario';
import {
  cargarProgresoBasePorSucursal,
  totalesProgresoMacro,
} from '@/lib/inventario/agregados-informes';
import { leerVueltasPsicos } from '@/lib/inventario/generar-base/cantidad-inventario';
import { obtenerProgresoPorMacroDrogueria } from '@/lib/inventario/base-productos-drogueria';
import { VUELTAS_PSICOS_DEFAULT } from '@/lib/inventario/vueltas-psicos-sucursal';
import {
  sumarValorizacionPorSucursal,
  valorizacionVacia,
  type ValorizacionSucursalMes,
} from '@/lib/inventario/valorizar-control';
import {
  queryBajasPorSucursalYMotivo,
  queryFacturacionPorSucursal,
  queryStockValorizado,
  queryValesPorSucursal,
  VALES_VACIO,
} from '@/lib/legacy-db/mysql-kpis-mensuales';
import { claseMotivoBaja } from '@/lib/legacy-db/motivos-baja';
import type { ProgresoTrimestreMacro } from '@/lib/inventario/trimestre-base';

export interface FilaTableroSucursal {
  sucursal_id: number;
  sucursal_nombre: string;
  es_drogueria: boolean;

  /** Avance del trimestre que contiene el mes. */
  avance_pct: number;
  esperado_pct: number;
  desvio_pp: number;
  avance_total: number;
  avance_inventariados: number;
  por_macro: ProgresoTrimestreMacro[];

  /** Faltantes a costo del mes (controles cerrados en el mes). */
  faltantes: number;
  sobrantes: number;
  /** Stock teórico a costo de lo efectivamente controlado. */
  stock_controlado: number;
  /** faltantes / stock controlado (%). El indicador principal. */
  faltantes_sobre_controlado_pct: number | null;
  /** faltantes / stock total valorizado (%). El de antes, para comparar. */
  faltantes_sobre_stock_pct: number | null;
  stock_total: number;
  controles: number;
  controles_sin_valorizar: number;

  /** Bajas de pérdida efectiva a PVP (vencidos, roturas, uso interno…). */
  bajas_perdida: number;
  /** Devoluciones al proveedor o a depósito, a PVP. */
  bajas_recuperable: number;
  facturacion: number;
  /** pérdidas / facturación neta (%). */
  bajas_sobre_facturacion_pct: number | null;

  vales: number;
}

export interface TableroSucursales {
  ym: string;
  trimestre: string;
  dias_habiles_totales: number;
  dias_habiles_transcurridos: number;
  esperado_pct: number;
  filas: FilaTableroSucursal[];
  /** Fuentes que no respondieron; la pantalla lo avisa en vez de mostrar ceros. */
  avisos: string[];
  /** La migración 033 no está aplicada o faltan controles por valorizar. */
  valorizacion_disponible: boolean;
}

function pct(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador <= 0) return null;
  return Math.round((numerador / denominador) * 10000) / 100;
}

export async function cargarTableroSucursales(
  admin: SupabaseClient,
  params: {
    year: number;
    month: number;
    sucursales: Array<{ sucursal: number; nombre: string; es_drogueria: boolean }>;
    /** Hasta qué día medir el avance esperado (normalmente hoy). */
    hoyYmd: string;
  }
): Promise<TableroSucursales> {
  const { year, month, sucursales, hoyYmd } = params;
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ids = sucursales.map((s) => s.sucursal);
  const idsFarmacia = sucursales.filter((s) => !s.es_drogueria).map((s) => s.sucursal);

  const { fecha_inicio: mesInicio, fecha_fin: mesFin } = rangoMesCalendarioYm(year, month);
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(mesInicio, mesFin);
  const hastaExclusivo = ymdAddDays(mesFin, 1);

  const { trimestre, fecha_inicio: triInicio, fecha_fin: triFin } = trimestreDelMes(year, month);
  const corte = mesFin < hoyYmd ? mesFin : hoyYmd;
  const diasTotales = contarDiasHabiles(triInicio, triFin);
  const diasTranscurridos = Math.min(
    diasTotales,
    contarDiasHabiles(triInicio, corte < triInicio ? triInicio : corte > triFin ? triFin : corte)
  );
  const esperadoPct = diasTotales > 0 ? Math.round((diasTranscurridos / diasTotales) * 1000) / 10 : 0;

  const avisos: string[] = [];

  const vueltasPsicos = await leerVueltasPsicos(admin, ids);

  // La droguería no está en `base_productos`: su avance sale de base_productos_drogueria.
  const drogueria = sucursales.find((s) => s.es_drogueria);

  const [progreso, progresoDrogueria, valorizacion, bajasRes, factRes, valesRes, stockRes] =
    await Promise.all([
    cargarProgresoBasePorSucursal(admin, trimestre, vueltasPsicos),
    drogueria
      ? obtenerProgresoPorMacroDrogueria(
          admin,
          trimestre,
          vueltasPsicos.get(drogueria.sucursal) ?? VUELTAS_PSICOS_DEFAULT
        ).catch(() => [])
      : Promise.resolve([]),
    sumarValorizacionPorSucursal(admin, desdeIso, hastaIso, ids),
    queryBajasPorSucursalYMotivo(idsFarmacia, mesInicio, hastaExclusivo),
    queryFacturacionPorSucursal(idsFarmacia, mesInicio, hastaExclusivo),
    queryValesPorSucursal(idsFarmacia, mesInicio, hastaExclusivo),
    queryStockValorizado(idsFarmacia),
  ]);

  if (!progreso) avisos.push('Falta aplicar la migración 030: el avance de inventario va en 0.');
  if (!valorizacion) {
    avisos.push(
      'Falta aplicar la migración 033: no hay faltantes valorizados por control.'
    );
  }
  if (!bajasRes.ok) avisos.push(`Bajas de stock no disponibles: ${bajasRes.error}`);
  if (!factRes.ok) avisos.push(`Facturación no disponible: ${factRes.error}`);
  if (!valesRes.ok) avisos.push(`Vales no disponibles: ${valesRes.error}`);
  if (!stockRes.ok) avisos.push(`Stock valorizado no disponible: ${stockRes.error}`);

  const bajas = bajasRes.ok ? bajasRes.data : new Map();
  const facturacion = factRes.ok ? factRes.data : new Map();
  const vales = valesRes.ok ? valesRes.data : new Map();
  const stock = stockRes.ok ? stockRes.data : new Map();

  let sinValorizarTotal = 0;

  const filas: FilaTableroSucursal[] = sucursales.map((s) => {
    const porMacro = s.es_drogueria ? progresoDrogueria : progreso?.get(s.sucursal) ?? [];
    const totales = totalesProgresoMacro(porMacro);
    const val: ValorizacionSucursalMes = valorizacion?.get(s.sucursal) ?? valorizacionVacia();
    sinValorizarTotal += val.sin_valorizar;

    let perdida = 0;
    let recuperable = 0;
    for (const m of bajas.get(s.sucursal) ?? []) {
      if (m.alta_baja !== 'B') continue;
      const clase = claseMotivoBaja(m.motivo_id, m.descripcion);
      if (clase === 'perdida') perdida += m.valor_pvp;
      else if (clase === 'recuperable') recuperable += m.valor_pvp;
    }

    const fact = facturacion.get(s.sucursal)?.neta ?? 0;
    const stockTotal = stock.get(s.sucursal)?.valor_costo ?? 0;
    const avancePct = totales.porcentaje;

    return {
      sucursal_id: s.sucursal,
      sucursal_nombre: s.nombre,
      es_drogueria: s.es_drogueria,

      avance_pct: avancePct,
      esperado_pct: esperadoPct,
      desvio_pp: Math.round((avancePct - esperadoPct) * 10) / 10,
      avance_total: totales.total,
      avance_inventariados: totales.inventariados,
      por_macro: porMacro,

      faltantes: val.dif_negativa_costo,
      sobrantes: val.dif_positiva_costo,
      stock_controlado: val.stock_controlado_costo,
      faltantes_sobre_controlado_pct: pct(val.dif_negativa_costo, val.stock_controlado_costo),
      faltantes_sobre_stock_pct: pct(val.dif_negativa_costo, stockTotal),
      stock_total: stockTotal,
      controles: val.controles,
      controles_sin_valorizar: val.sin_valorizar,

      bajas_perdida: perdida,
      bajas_recuperable: recuperable,
      facturacion: fact,
      bajas_sobre_facturacion_pct: pct(perdida, fact),

      vales: (vales.get(s.sucursal) ?? VALES_VACIO).vales,
    };
  });

  if (sinValorizarTotal > 0) {
    avisos.push(
      `${sinValorizarTotal} controles cerrados todavía no están valorizados: corré ` +
        'scripts/valorizar-controles-cerrados.cjs para completar el histórico.'
    );
  }

  return {
    ym,
    trimestre,
    dias_habiles_totales: diasTotales,
    dias_habiles_transcurridos: diasTranscurridos,
    esperado_pct: esperadoPct,
    filas,
    avisos,
    valorizacion_disponible: valorizacion !== null,
  };
}
