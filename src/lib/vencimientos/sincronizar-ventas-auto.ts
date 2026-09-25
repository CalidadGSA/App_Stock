/**
 * Sync automático de ventas → Por Vencer / Para devolver.
 *
 * ESTADO: desconectado de la UI (2026-09-14). El marcado de vendido es manual.
 * Conservar este módulo para reactivar: ver docs/VENTAS_AUTO_POR_VENCER.md
 *
 * Consulta ventas reales posteriores a cada carga (Onze / Quantio), reparte FIFO
 * por vencimiento y persiste el saldo. Liquidado cuando vendido alcanza lo cargado.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';
import {
  asignarVentasAlProducto,
  fechaDiaDeIso,
  type LineaParaAsignar,
} from '@/lib/vencimientos/ventas-auto-asignacion';
import {
  agruparVentasPorProducto,
  getVentasDiariasSucursal,
  type FuenteVentasLegacy,
} from '@/lib/vencimientos/ventas-legacy-router';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/** Tope de historial de ventas a consultar, para no barrer años de facturación. */
const VENTANA_MAX_DIAS = 400;
/** Paginado de escrituras masivas en Supabase. */
const UPDATE_CHUNK = 300;
/** Ventana en la que se reutiliza el resultado (evita re-consultar al paginar o filtrar). */
const RESULTADO_FRESCO_MS = 60_000;

export type SincronizarVentasAutoStatus =
  | 'ok'
  | 'sin_lineas'
  | 'skipped_unavailable'
  | 'error';

export interface SincronizarVentasAutoResumen {
  status: SincronizarVentasAutoStatus;
  fuente: FuenteVentasLegacy | null;
  lineas_evaluadas: number;
  lineas_actualizadas: number;
  cajas_descontadas: number;
  lineas_liquidadas: number;
  latency_ms: number;
  desde_cache: boolean;
  checked_at: string | null;
  error?: string;
}

interface LineaActiva extends LineaParaAsignar {
  controlId: string;
  productoId: number;
  cantidadRestante: number;
  vendidoAuto: number;
}

type CorridaEnCurso = { promesa: Promise<SincronizarVentasAutoResumen> };

const corridasEnCurso = new Map<number, CorridaEnCurso>();
const ultimoResultado = new Map<number, { resumen: SincronizarVentasAutoResumen; enMs: number }>();

function hoyMenosDiasYmd(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function leerLineasActivas(
  admin: AdminClient,
  sucursalId: number
): Promise<{ ok: true; lineas: LineaActiva[] } | { ok: false; error: string }> {
  const rows: Array<Record<string, unknown>> = [];
  const chunkSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, fecha_vencimiento, fecha_registro, cantidad, cantidad_original, cantidad_vendida_auto, controles_vencimientos!inner(sucursal_id)'
      )
      .eq('eliminado', 0)
      .eq('devuelto', 0)
      .eq('vendido', 0)
      .gt('cantidad', 0)
      .eq('controles_vencimientos.sucursal_id', sucursalId)
      .order('fecha_vencimiento', { ascending: true })
      .range(from, from + chunkSize - 1);

    if (error) return { ok: false, error: error.message };
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < chunkSize) break;
    from += chunkSize;
  }

  // `cantidad_original` puede faltar en filas viejas si la migración no corrió: se reconstruye
  // con el historial de ventas para no perder el tope de la línea.
  const sinOriginal = rows.filter((r) => r.cantidad_original == null).map((r) => String(r.id));
  const ventasHistorial =
    sinOriginal.length > 0
      ? await sumarCantidadVendidaPorDetalle(admin, sinOriginal)
      : new Map<string, number>();

  const lineas: LineaActiva[] = [];
  for (const r of rows) {
    const productoId = Number(String(r.producto_id_sistema ?? '').trim());
    if (!Number.isFinite(productoId) || productoId <= 0) continue;

    const cantidadRestante = Number(r.cantidad ?? 0);
    const cantidadOriginal =
      r.cantidad_original != null
        ? Number(r.cantidad_original)
        : cantidadRestante + (ventasHistorial.get(String(r.id)) ?? 0);
    if (!Number.isFinite(cantidadOriginal) || cantidadOriginal <= 0) continue;

    lineas.push({
      id: String(r.id),
      controlId: String(r.control_id ?? ''),
      productoId,
      fechaVencimiento: String(r.fecha_vencimiento ?? ''),
      fechaRegistro: String(r.fecha_registro ?? ''),
      cantidadOriginal,
      cantidadRestante,
      vendidoAuto: Number(r.cantidad_vendida_auto ?? 0) || 0,
    });
  }

  return { ok: true, lineas };
}

async function marcarChequeadas(admin: AdminClient, ids: string[], checkedAt: string) {
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const { error } = await admin
      .from('controles_vencimientos_detalle')
      .update({ ventas_auto_check_at: checkedAt })
      .in('id', chunk);
    if (error) {
      console.error('[ventas-auto] marcando chequeadas:', error.message);
      return;
    }
  }
}

async function ejecutarSincronizacion(
  admin: AdminClient,
  sucursalId: number
): Promise<SincronizarVentasAutoResumen> {
  const t0 = Date.now();
  const base: SincronizarVentasAutoResumen = {
    status: 'ok',
    fuente: null,
    lineas_evaluadas: 0,
    lineas_actualizadas: 0,
    cajas_descontadas: 0,
    lineas_liquidadas: 0,
    latency_ms: 0,
    desde_cache: false,
    checked_at: null,
  };

  const activas = await leerLineasActivas(admin, sucursalId);
  if (!activas.ok) {
    return { ...base, status: 'error', latency_ms: Date.now() - t0, error: activas.error };
  }
  if (activas.lineas.length === 0) {
    return { ...base, status: 'sin_lineas', latency_ms: Date.now() - t0 };
  }

  const lineas = activas.lineas;
  const pisoVentana = hoyMenosDiasYmd(VENTANA_MAX_DIAS);
  const cargaMasAntigua = lineas
    .map((l) => fechaDiaDeIso(l.fechaRegistro))
    .filter((d) => d.length === 10)
    .sort((a, b) => a.localeCompare(b))[0];
  const desdeFecha =
    cargaMasAntigua && cargaMasAntigua > pisoVentana ? cargaMasAntigua : pisoVentana;

  const resultadoVentas = await getVentasDiariasSucursal({
    sucursalId,
    productoIds: lineas.map((l) => l.productoId),
    desdeFecha,
  });

  if (!resultadoVentas.ok) {
    return {
      ...base,
      status: 'skipped_unavailable',
      fuente: resultadoVentas.fuente,
      lineas_evaluadas: lineas.length,
      latency_ms: Date.now() - t0,
      error: resultadoVentas.error,
    };
  }

  const ventasPorProducto = agruparVentasPorProducto(resultadoVentas.ventas);
  const lineasPorProducto = new Map<number, LineaActiva[]>();
  for (const l of lineas) {
    const lista = lineasPorProducto.get(l.productoId);
    if (lista) lista.push(l);
    else lineasPorProducto.set(l.productoId, [l]);
  }

  const checkedAt = new Date().toISOString();
  let lineasActualizadas = 0;
  let cajasDescontadas = 0;
  let lineasLiquidadas = 0;
  const controlesTocados = new Set<string>();
  const idsSinCambio: string[] = [];

  for (const [productoId, lineasProducto] of lineasPorProducto) {
    const ventas = ventasPorProducto.get(productoId);
    if (!ventas || ventas.length === 0) {
      for (const l of lineasProducto) idsSinCambio.push(l.id);
      continue;
    }

    const objetivos = asignarVentasAlProducto(lineasProducto, ventas);

    for (const linea of lineasProducto) {
      // Lo marcado a mano antes de este cambio cuenta como parte de la misma venta real.
      const vendidoManual = Math.max(
        0,
        redondear2(linea.cantidadOriginal - linea.cantidadRestante - linea.vendidoAuto)
      );
      const objetivoTotal = objetivos.get(linea.id) ?? 0;
      const topeAuto = Math.max(0, redondear2(linea.cantidadOriginal - vendidoManual));
      const objetivoAuto = Math.min(topeAuto, Math.max(0, redondear2(objetivoTotal - vendidoManual)));

      let delta = redondear2(objetivoAuto - linea.vendidoAuto);
      // Si la ventana consultada no cubre toda la vida de la línea, el total puede quedar
      // corto y no corresponde devolver stock que ya se dio por vendido.
      const ventanaCubreLinea = desdeFecha <= fechaDiaDeIso(linea.fechaRegistro);
      if (delta < 0 && !ventanaCubreLinea) delta = 0;

      if (Math.abs(delta) < 0.005) {
        idsSinCambio.push(linea.id);
        continue;
      }

      const autoFinal = redondear2(linea.vendidoAuto + delta);
      const nuevaRestante = Math.max(
        0,
        redondear2(linea.cantidadOriginal - vendidoManual - autoFinal)
      );
      const liquidada = nuevaRestante <= 0;

      const { error: upErr } = await admin
        .from('controles_vencimientos_detalle')
        .update({
          cantidad: nuevaRestante,
          cantidad_original: linea.cantidadOriginal,
          cantidad_vendida_auto: autoFinal,
          vendido: liquidada ? 1 : 0,
          ventas_auto_check_at: checkedAt,
        })
        .eq('id', linea.id);

      if (upErr) {
        console.error('[ventas-auto] actualizando detalle:', upErr.message, linea.id);
        continue;
      }

      const { error: ventaErr } = await admin.from('vencimientos_detalle_ventas').insert({
        detalle_id: linea.id,
        cantidad_vendida: delta,
        cantidad_restante_despues: nuevaRestante,
        linea_vendida_completa: liquidada ? 1 : 0,
        es_ajuste: delta < 0 ? 1 : 0,
        origen: 'auto',
        usuario_id: null,
        sucursal_id: sucursalId,
      });

      if (ventaErr) {
        // El saldo ya quedó actualizado; sin historial no se puede auditar, así que se revierte.
        await admin
          .from('controles_vencimientos_detalle')
          .update({
            cantidad: linea.cantidadRestante,
            cantidad_vendida_auto: linea.vendidoAuto,
            vendido: 0,
          })
          .eq('id', linea.id);
        console.error('[ventas-auto] registrando historial:', ventaErr.message, linea.id);
        continue;
      }

      lineasActualizadas += 1;
      cajasDescontadas = redondear2(cajasDescontadas + delta);
      if (liquidada) lineasLiquidadas += 1;
      if (linea.controlId) controlesTocados.add(linea.controlId);
    }
  }

  if (idsSinCambio.length > 0) {
    await marcarChequeadas(admin, idsSinCambio, checkedAt);
  }

  for (const controlId of controlesTocados) {
    await admin
      .from('controles_vencimientos')
      .update({ updated_at: checkedAt })
      .eq('id', controlId);
  }

  console.info(
    `[ventas-auto] sucursal ${sucursalId} (${resultadoVentas.fuente}): ${lineasActualizadas}/${lineas.length} líneas actualizadas, ${cajasDescontadas} cajas, ${lineasLiquidadas} liquidadas (${Date.now() - t0}ms)`
  );

  return {
    status: 'ok',
    fuente: resultadoVentas.fuente,
    lineas_evaluadas: lineas.length,
    lineas_actualizadas: lineasActualizadas,
    cajas_descontadas: cajasDescontadas,
    lineas_liquidadas: lineasLiquidadas,
    latency_ms: Date.now() - t0,
    desde_cache: false,
    checked_at: checkedAt,
  };
}

/**
 * Sincroniza las ventas de una sucursal. Corridas simultáneas comparten la misma consulta y,
 * salvo `forzar`, se reutiliza el resultado del último minuto para que paginar o filtrar
 * no vuelva a golpear la base legacy.
 */
export async function sincronizarVentasAutoSucursal(args: {
  admin: AdminClient;
  sucursalId: number;
  forzar?: boolean;
}): Promise<SincronizarVentasAutoResumen> {
  const { admin, sucursalId, forzar = false } = args;

  const enCurso = corridasEnCurso.get(sucursalId);
  if (enCurso) return enCurso.promesa;

  if (!forzar) {
    const previo = ultimoResultado.get(sucursalId);
    if (previo && Date.now() - previo.enMs < RESULTADO_FRESCO_MS) {
      return { ...previo.resumen, desde_cache: true };
    }
  }

  const promesa = ejecutarSincronizacion(admin, sucursalId)
    .then((resumen) => {
      if (resumen.status === 'ok' || resumen.status === 'sin_lineas') {
        ultimoResultado.set(sucursalId, { resumen, enMs: Date.now() });
      }
      return resumen;
    })
    .finally(() => {
      corridasEnCurso.delete(sucursalId);
    });

  corridasEnCurso.set(sucursalId, { promesa });
  return promesa;
}
