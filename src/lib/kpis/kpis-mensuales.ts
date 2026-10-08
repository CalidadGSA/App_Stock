/**
 * KPIs mensuales de sucursal (visibles para todos los usuarios):
 *
 *  1. Diferencias de inventario valorizadas (todos los orígenes/tipos de control) vs stock valorizado.
 *  2. Bajas/altas de stock por motivo (onze_center) vs facturación neta del mes.
 *  3. Vales (pendientes de entrega) generados en el mes.
 *  4. Avance de inventario del trimestre: real vs esperado según días hábiles transcurridos.
 *
 * Criterios (ver también `mysql-kpis-mensuales.ts`):
 *  - Diferencias: líneas con diferencia de controles cerrados cuya `fecha_fin` cae en el mes
 *    (mismo criterio que Informe mensual). Valor = (cajas + unidades sueltas / unidades por caja)
 *    × costo de lista. Positivo = sobrante, negativo = faltante.
 *  - Stock valorizado: onze_center.stock a costo de lista (misma base que las diferencias). Como
 *    Onze solo guarda el stock actual, para meses pasados se usa el snapshot de
 *    `kpi_stock_valorizado_mensual`; si no existe, el stock actual marcado como aproximado.
 *  - Bajas: altas (A) suman, bajas (B) restan; a costo y a PVP por línea de operación.
 *  - Facturación: FV/TF/TK − NC vinculadas a esas ventas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  etiquetaTipoControlInventario,
  inferirTipoControlInventario,
  type TipoControlInventario,
} from '@/lib/inventario/tipo-control';
import {
  costosMedicamentosPorCodplex,
  rangoMesCalendarioYm,
} from '@/lib/inventario/informe-mensual-metricas';
import { valorDiferencia } from '@/lib/inventario/diferencia-valorizada';
import { getUnidadesPorCajaOnze } from '@/lib/legacy-db/onze-medicamentos';
import {
  queryBajasPorMotivo,
  queryFacturacionMes,
  queryStockValorizado,
  queryValesMes,
  type BajaPorMotivo,
  type FacturacionMes,
  type StockValorizado,
  type ValesMes,
} from '@/lib/legacy-db/mysql-kpis-mensuales';
import {
  cargarAvanceInventario,
  type AvanceInventarioKpi,
} from '@/lib/kpis/avance-inventario';
import { claseMotivoBaja, type ClaseMotivoBaja } from '@/lib/legacy-db/motivos-baja';
import {
  sumarValorizacionPorSucursal,
  valorizacionVacia,
  type ValorizacionSucursalMes,
} from '@/lib/inventario/valorizar-control';
import { calendarioActualArgentina } from '@/lib/vencimientos-mes-anio-filtro';
import { fechaHoyArgentinaYmd, parseYm, rangoFechasArgentinaIso, ymdAddDays } from '@/lib/utils';

export type EstadoFuente = 'ok' | 'unavailable' | 'no_aplica';

export interface MontoSigno {
  positivo: number;
  negativo: number;
  neto: number;
}

export interface DiferenciasKpi extends MontoSigno {
  lineas: number;
  controles: number;
  por_origen: Array<MontoSigno & { tipo: TipoControlInventario; etiqueta: string; lineas: number }>;
}

export interface StockValorizadoKpi {
  estado: EstadoFuente;
  error?: string;
  valor_costo: number;
  valor_ppp: number;
  cajas: number;
  productos: number;
  /** 'actual' = stock de hoy (mes en curso); 'snapshot' = guardado ese mes; 'aproximado' = mes pasado sin snapshot (usa el stock de hoy). */
  fuente: 'actual' | 'snapshot' | 'aproximado';
  tomado_at: string | null;
}

export interface BajasPorClase {
  /** Vencidos, roturas, uso interno: plata que no vuelve. */
  perdida: number;
  /** Devoluciones al proveedor o a depósito. */
  recuperable: number;
  /** Correcciones administrativas de stock. */
  ajuste: number;
  /** Motivos que todavía no están clasificados. */
  otros: number;
}

export interface BajasKpi {
  estado: EstadoFuente;
  error?: string;
  /** A costo de la línea. */
  costo: MontoSigno;
  /** A precio de venta de la línea. */
  pvp: MontoSigno;
  lineas: number;
  operaciones: number;
  por_motivo: Array<BajaPorMotivo & { clase: ClaseMotivoBaja }>;
  /** Solo las bajas (alta_baja = 'B'), a PVP, separadas por clase de motivo. */
  pvp_por_clase: BajasPorClase;
  /** Lo mismo a costo. */
  costo_por_clase: BajasPorClase;
}

export interface FacturacionKpi extends FacturacionMes {
  estado: EstadoFuente;
  error?: string;
}

export interface ValesKpi extends ValesMes {
  estado: EstadoFuente;
  error?: string;
}

export interface KpisMensualesSucursal {
  ym: string;
  sucursal_id: number;
  diferencias: DiferenciasKpi;
  stock_valorizado: StockValorizadoKpi;
  bajas: BajasKpi;
  facturacion: FacturacionKpi;
  vales: ValesKpi;
  avance_inventario: AvanceInventarioKpi;
  /**
   * Stock teórico a costo de los productos efectivamente inventariados en el mes, sumado de
   * los controles cerrados. Es el denominador de los ratios de diferencias.
   */
  controlado: ValorizacionSucursalMes & { disponible: boolean };
  ratios: {
    /** Faltantes / valorizado de lo inventariado (%). El indicador principal. */
    faltantes_sobre_controlado_pct: number | null;
    /** |neto| / valorizado de lo inventariado (%). */
    neto_sobre_controlado_pct: number | null;
    /** |neto diferencias| / stock valorizado a costo (%). Criterio anterior. */
    diferencias_neto_sobre_stock_pct: number | null;
    /** (positivo + negativo) / stock valorizado a costo (%). */
    diferencias_bruto_sobre_stock_pct: number | null;
    /** |neto bajas a PVP| / facturación neta (%). */
    bajas_neto_sobre_facturacion_pct: number | null;
    /** bajas (B) a PVP / facturación neta (%). Incluye devoluciones recuperables. */
    bajas_sobre_facturacion_pct: number | null;
    /** Solo pérdidas efectivas a PVP / facturación neta (%). Es el indicador a mirar. */
    perdidas_sobre_facturacion_pct: number | null;
  };
}

function signo(): MontoSigno {
  return { positivo: 0, negativo: 0, neto: 0 };
}

function cerrarSigno(s: MontoSigno): MontoSigno {
  return { ...s, neto: s.positivo - s.negativo };
}

function pct(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador <= 0) return null;
  return Math.round((numerador / denominador) * 10000) / 100;
}

const DETALLE_CHUNK = 1000;

type ControlMes = { id: string; tipo: string | null; origen: string | null };

/** Controles cerrados de la sucursal cuya fecha de cierre cae en el mes (consulta chica, con índice). */
async function controlesCerradosDelMes(
  admin: SupabaseClient,
  sucursalId: number,
  year: number,
  month: number
): Promise<ControlMes[]> {
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month);
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fecha_inicio, fecha_fin);
  const { data, error } = await admin
    .from('controles_inventario')
    .select('id, tipo, origen')
    .eq('sucursal_id', sucursalId)
    .eq('estado', 'cerrado')
    .gte('fecha_fin', desdeIso)
    .lte('fecha_fin', hastaIso);
  if (error) {
    console.error('kpis controlesCerradosDelMes:', error.message);
    return [];
  }
  return (data ?? []) as ControlMes[];
}

/**
 * Diferencias en cajas × costo de lista, agrupadas por tipo de control.
 * Se consulta primero la cabecera y después el detalle por `control_id` (índice idx_cid_control):
 * el join `controles_inventario!inner(...)` sobre el detalle completo se pasaba del statement_timeout.
 */
async function cargarDiferencias(
  admin: SupabaseClient,
  sucursalId: number,
  year: number,
  month: number
): Promise<DiferenciasKpi> {
  const total = signo();
  const controlesConDif = new Set<string>();
  const porTipo = new Map<TipoControlInventario, MontoSigno & { lineas: number }>();
  let lineas = 0;

  const controles = await controlesCerradosDelMes(admin, sucursalId, year, month);
  if (controles.length === 0) {
    return { ...cerrarSigno(total), lineas: 0, controles: 0, por_origen: [] };
  }
  const tipoPorControl = new Map(
    controles.map((c) => [
      c.id,
      inferirTipoControlInventario({
        tipo: c.tipo,
        origen: c.origen,
        categoria_macro: null,
        descripcion: null,
      }),
    ])
  );
  const ids = controles.map((c) => c.id);

  type Fila = {
    control_id: string;
    producto_id_sistema: string | null;
    stock_sist_cajas: number | string | null;
    stock_sist_unidades: number | string | null;
    stock_real_cajas: number | string | null;
    stock_real_unidades: number | string | null;
  };

  // Lotes de controles (los uuid van en la URL de PostgREST) y páginas de detalle dentro de cada lote.
  const CONTROLES_LOTE = 100;
  const lotes: Array<{ ids: string[]; offset: number }> = [];
  for (let i = 0; i < ids.length; i += CONTROLES_LOTE) {
    lotes.push({ ids: ids.slice(i, i + CONTROLES_LOTE), offset: 0 });
  }

  while (lotes.length > 0) {
    const lote = lotes[0]!;
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select(
        'control_id, producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades'
      )
      .in('control_id', lote.ids)
      .eq('con_diferencias', 1)
      .order('id', { ascending: true })
      .range(lote.offset, lote.offset + DETALLE_CHUNK - 1);
    if (error) {
      console.error('kpis cargarDiferencias:', error.message);
      break;
    }
    const batch = (data ?? []) as Fila[];
    if (batch.length < DETALLE_CHUNK) lotes.shift();
    else lote.offset += DETALLE_CHUNK;
    if (batch.length === 0) continue;

    const productoIds = batch
      .map((r) => String(r.producto_id_sistema ?? '').trim())
      .filter(Boolean);
    const [costos, unidadesPorCaja] = await Promise.all([
      costosMedicamentosPorCodplex(admin, productoIds),
      getUnidadesPorCajaOnze(productoIds),
    ]);

    for (const r of batch) {
      const pid = String(r.producto_id_sistema ?? '').trim();
      const diffCajas = Number(r.stock_real_cajas ?? 0) - Number(r.stock_sist_cajas ?? 0);
      const diffUnidades =
        Number(r.stock_real_unidades ?? 0) - Number(r.stock_sist_unidades ?? 0);
      if (diffCajas === 0 && diffUnidades === 0) continue;
      const v = valorDiferencia(
        diffCajas,
        diffUnidades,
        unidadesPorCaja.get(pid),
        costos.get(pid) ?? 0
      );
      if (!Number.isFinite(v) || v === 0) continue;

      lineas += 1;
      controlesConDif.add(r.control_id);
      const tipo = tipoPorControl.get(r.control_id) ?? 'ocasional_sucursal';
      const bucket = porTipo.get(tipo) ?? { ...signo(), lineas: 0 };
      bucket.lineas += 1;
      if (v > 0) {
        bucket.positivo += v;
        total.positivo += v;
      } else {
        bucket.negativo += Math.abs(v);
        total.negativo += Math.abs(v);
      }
      porTipo.set(tipo, bucket);
    }
  }

  const por_origen = Array.from(porTipo.entries())
    .map(([tipo, b]) => ({
      tipo,
      etiqueta: etiquetaTipoControlInventario(tipo),
      lineas: b.lineas,
      ...cerrarSigno(b),
    }))
    .sort((a, b) => b.positivo + b.negativo - (a.positivo + a.negativo));

  return {
    ...cerrarSigno(total),
    lineas,
    controles: controlesConDif.size,
    por_origen,
  };
}

type SnapshotRow = {
  sucursal_id: number;
  ym: string;
  valor_costo: number | string;
  valor_ppp: number | string;
  cajas: number | string;
  productos: number;
  tomado_at: string;
};

function tablaSnapshotAusente(msg: string | undefined): boolean {
  return /kpi_stock_valorizado_mensual/i.test(String(msg ?? ''));
}

async function leerSnapshot(
  admin: SupabaseClient,
  sucursalId: number,
  ym: string
): Promise<SnapshotRow | null> {
  const { data, error } = await admin
    .from('kpi_stock_valorizado_mensual')
    .select('sucursal_id, ym, valor_costo, valor_ppp, cajas, productos, tomado_at')
    .eq('sucursal_id', sucursalId)
    .eq('ym', ym)
    .maybeSingle();
  if (error) {
    if (!tablaSnapshotAusente(error.message)) console.warn('kpi snapshot read:', error.message);
    return null;
  }
  return (data as SnapshotRow | null) ?? null;
}

/** Guarda/actualiza el snapshot del mes para las sucursales indicadas (ignora si la migración 028 no corrió). */
export async function guardarSnapshotStockValorizado(
  admin: SupabaseClient,
  ym: string,
  valores: Map<number, StockValorizado>
): Promise<{ guardados: number; error: string | null }> {
  const rows = Array.from(valores.entries()).map(([sucursal_id, v]) => ({
    sucursal_id,
    ym,
    valor_costo: Math.round(v.valor_costo * 100) / 100,
    valor_ppp: Math.round(v.valor_ppp * 100) / 100,
    cajas: v.cajas,
    productos: v.productos,
    tomado_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return { guardados: 0, error: null };
  const { error } = await admin
    .from('kpi_stock_valorizado_mensual')
    .upsert(rows, { onConflict: 'sucursal_id,ym' });
  if (error) {
    if (!tablaSnapshotAusente(error.message)) console.warn('kpi snapshot upsert:', error.message);
    return { guardados: 0, error: error.message };
  }
  return { guardados: rows.length, error: null };
}

/**
 * Cron diario: snapshot de todas las sucursales para el mes del día **anterior** (a las 00:00 del
 * día 1 se cierra el mes que terminó con el stock de ese momento).
 */
export async function tomarSnapshotStockValorizadoDiario(
  admin: SupabaseClient,
  sucursalIds: number[]
): Promise<{ ym: string; guardados: number; error: string | null }> {
  const ym = ymdAddDays(fechaHoyArgentinaYmd(), -1).slice(0, 7);
  const res = await queryStockValorizado(sucursalIds);
  if (!res.ok) return { ym, guardados: 0, error: res.error };
  const out = await guardarSnapshotStockValorizado(admin, ym, res.data);
  return { ym, ...out };
}

async function cargarStockValorizado(
  admin: SupabaseClient,
  sucursalId: number,
  ym: string,
  esMesActual: boolean
): Promise<StockValorizadoKpi> {
  const vacio = (estado: EstadoFuente, error?: string): StockValorizadoKpi => ({
    estado,
    error,
    valor_costo: 0,
    valor_ppp: 0,
    cajas: 0,
    productos: 0,
    fuente: 'actual',
    tomado_at: null,
  });

  if (!esMesActual) {
    const snap = await leerSnapshot(admin, sucursalId, ym);
    if (snap) {
      return {
        estado: 'ok',
        valor_costo: Number(snap.valor_costo),
        valor_ppp: Number(snap.valor_ppp),
        cajas: Number(snap.cajas),
        productos: Number(snap.productos),
        fuente: 'snapshot',
        tomado_at: snap.tomado_at,
      };
    }
  }

  const live = await queryStockValorizado([sucursalId]);
  if (!live.ok) return vacio('unavailable', live.error);
  const v = live.data.get(sucursalId) ?? { productos: 0, cajas: 0, valor_costo: 0, valor_ppp: 0 };

  if (esMesActual) {
    // Último valor visto del mes en curso: queda como snapshot cuando el mes cierre.
    await guardarSnapshotStockValorizado(admin, ym, new Map([[sucursalId, v]]));
  }

  return {
    estado: 'ok',
    ...v,
    fuente: esMesActual ? 'actual' : 'aproximado',
    tomado_at: new Date().toISOString(),
  };
}

function clasesVacias(): BajasPorClase {
  return { perdida: 0, recuperable: 0, ajuste: 0, otros: 0 };
}

function agregarBajas(rows: BajaPorMotivo[]): BajasKpi {
  const costo = signo();
  const pvp = signo();
  const pvpPorClase = clasesVacias();
  const costoPorClase = clasesVacias();
  let lineas = 0;
  let operaciones = 0;

  const conClase = rows.map((r) => ({
    ...r,
    clase: claseMotivoBaja(r.motivo_id, r.descripcion),
  }));

  for (const r of conClase) {
    lineas += r.lineas;
    operaciones += r.operaciones;
    if (r.alta_baja === 'A') {
      costo.positivo += r.valor_costo;
      pvp.positivo += r.valor_pvp;
      continue;
    }
    costo.negativo += r.valor_costo;
    pvp.negativo += r.valor_pvp;
    // Las altas no son pérdida ni devolución: la apertura por clase es solo de las bajas.
    pvpPorClase[r.clase] += r.valor_pvp;
    costoPorClase[r.clase] += r.valor_costo;
  }

  return {
    estado: 'ok',
    costo: cerrarSigno(costo),
    pvp: cerrarSigno(pvp),
    lineas,
    operaciones,
    por_motivo: conClase,
    pvp_por_clase: pvpPorClase,
    costo_por_clase: costoPorClase,
  };
}

export async function cargarKpisMensualesSucursal(
  admin: SupabaseClient,
  params: { sucursalId: number; ym: string; esDrogueria: boolean }
): Promise<KpisMensualesSucursal | { error: string }> {
  const parsed = parseYm(params.ym);
  if (!parsed) return { error: 'Mes inválido (formato YYYY-MM)' };
  const { year, month } = parsed;
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month);
  const hastaExclusivo = ymdAddDays(fecha_fin, 1);
  const esMesActual = calendarioActualArgentina().ym === ym;

  const noAplica = 'La sucursal droguería opera con Quantio; estos datos salen de onze_center.';

  const [diferencias, stock, bajasRes, factRes, valesRes, avanceInventario, valorizacion] =
    await Promise.all([
    cargarDiferencias(admin, params.sucursalId, year, month),
    params.esDrogueria
      ? Promise.resolve<StockValorizadoKpi>({
          estado: 'no_aplica',
          error: noAplica,
          valor_costo: 0,
          valor_ppp: 0,
          cajas: 0,
          productos: 0,
          fuente: 'actual',
          tomado_at: null,
        })
      : cargarStockValorizado(admin, params.sucursalId, ym, esMesActual),
    params.esDrogueria
      ? Promise.resolve(null)
      : queryBajasPorMotivo(params.sucursalId, fecha_inicio, hastaExclusivo),
    params.esDrogueria
      ? Promise.resolve(null)
      : queryFacturacionMes(params.sucursalId, fecha_inicio, hastaExclusivo),
    params.esDrogueria
      ? Promise.resolve(null)
      : queryValesMes(params.sucursalId, fecha_inicio, hastaExclusivo),
    cargarAvanceInventario(admin, {
      sucursalId: params.sucursalId,
      year,
      month,
      esDrogueria: params.esDrogueria,
      esMesActual,
    }),
    (async () => {
      const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fecha_inicio, fecha_fin);
      return sumarValorizacionPorSucursal(admin, desdeIso, hastaIso, [params.sucursalId]);
    })(),
  ]);

  const controlado = {
    ...(valorizacion?.get(params.sucursalId) ?? valorizacionVacia()),
    // Sin la migración 033 (o con controles sin valorizar) no hay denominador confiable.
    disponible: valorizacion !== null,
  };

  const bajas: BajasKpi =
    bajasRes == null
      ? { ...agregarBajas([]), estado: 'no_aplica', error: noAplica }
      : bajasRes.ok
        ? agregarBajas(bajasRes.data)
        : { ...agregarBajas([]), estado: 'unavailable', error: bajasRes.error };

  const factVacia: FacturacionMes = {
    ventas_brutas: 0,
    comprobantes: 0,
    notas_credito: 0,
    notas_credito_comprobantes: 0,
    neta: 0,
  };
  const facturacion: FacturacionKpi =
    factRes == null
      ? { ...factVacia, estado: 'no_aplica', error: noAplica }
      : factRes.ok
        ? { ...factRes.data, estado: 'ok' }
        : { ...factVacia, estado: 'unavailable', error: factRes.error };

  const valesVacios: ValesMes = {
    vales: 0,
    lineas: 0,
    unidades: 0,
    vales_pendientes: 0,
    lineas_entregadas: 0,
    lineas_pendientes: 0,
    lineas_canceladas: 0,
  };
  const vales: ValesKpi =
    valesRes == null
      ? { ...valesVacios, estado: 'no_aplica', error: noAplica }
      : valesRes.ok
        ? { ...valesRes.data, estado: 'ok' }
        : { ...valesVacios, estado: 'unavailable', error: valesRes.error };

  const controladoOk = controlado.disponible ? controlado.stock_controlado_costo : 0;
  const stockOk = stock.estado === 'ok' ? stock.valor_costo : 0;
  const factOk = facturacion.estado === 'ok' ? facturacion.neta : 0;

  return {
    ym,
    sucursal_id: params.sucursalId,
    diferencias,
    stock_valorizado: stock,
    bajas,
    facturacion,
    vales,
    avance_inventario: avanceInventario,
    controlado,
    ratios: {
      faltantes_sobre_controlado_pct: pct(diferencias.negativo, controladoOk),
      neto_sobre_controlado_pct: pct(Math.abs(diferencias.neto), controladoOk),
      diferencias_neto_sobre_stock_pct: pct(Math.abs(diferencias.neto), stockOk),
      diferencias_bruto_sobre_stock_pct: pct(diferencias.positivo + diferencias.negativo, stockOk),
      bajas_neto_sobre_facturacion_pct:
        bajas.estado === 'ok' ? pct(Math.abs(bajas.pvp.neto), factOk) : null,
      bajas_sobre_facturacion_pct: bajas.estado === 'ok' ? pct(bajas.pvp.negativo, factOk) : null,
      perdidas_sobre_facturacion_pct:
        bajas.estado === 'ok' ? pct(bajas.pvp_por_clase.perdida, factOk) : null,
    },
  };
}
