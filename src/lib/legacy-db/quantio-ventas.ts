/**
 * Ventas por producto en Quantio (droguería), desde factcabecera + factlineas.
 *
 * El signo de cada tipo de comprobante sale de `comprobantes.OperacionStock`
 * (-1 saca mercadería, +1 la devuelve). En Quantio el que descuenta stock es el
 * pedido de farmacia (PD), no el remito (RM, OperacionStock = 0), así que la lista
 * no se puede asumir igual a la de Onze.
 */

import { getQuantioPool, isQuantioDatabaseConfigured } from '@/lib/legacy-db/quantio-mysql';
import {
  chunkProductoIds,
  clasificarErrorVentasLegacy,
  conTimeout,
  type VentaDiariaProducto,
  type VentasLegacyQuery,
  type VentasLegacyResult,
} from '@/lib/legacy-db/ventas-legacy-types';

const DEFAULT_VENTAS_QUERY_TIMEOUT_MS = 30_000;
const TIPOS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Fallback si no se puede leer `comprobantes` (valores observados en plexdr). */
const FALLBACK_TIPOS_SALIDA = ['PD', 'FV', 'TF', 'TK', 'LM', 'FE', 'ND'];
const FALLBACK_TIPOS_DEVOLUCION = ['NC', 'CE', 'RC'];

/** Estado de comprobante anulado/cancelado (`factestados`: «Pedido cancelado»). */
const ESTADO_CANCELADO = 'CA';

type TiposMovimientoStock = { salida: string[]; devolucion: string[] };

let tiposCache: { valor: TiposMovimientoStock; expiraEn: number } | null = null;

function ventasQueryTimeoutMs(): number {
  const n = parseInt(process.env.QUANTIO_VENTAS_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VENTAS_QUERY_TIMEOUT_MS;
}

/** Sucursal de la droguería en Quantio (la app la identifica como sucursal 13). */
export function getSucursalVentasQuantio(): number {
  const n = parseInt(process.env.QUANTIO_VENTAS_SUCURSAL ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function getTiposMovimientoStock(): Promise<TiposMovimientoStock> {
  const ahora = Date.now();
  if (tiposCache && tiposCache.expiraEn > ahora) return tiposCache.valor;

  const fallback: TiposMovimientoStock = {
    salida: FALLBACK_TIPOS_SALIDA,
    devolucion: FALLBACK_TIPOS_DEVOLUCION,
  };

  try {
    const pool = getQuantioPool();
    const [rows] = await conTimeout(
      pool.query('SELECT Tipo, MIN(OperacionStock) AS op FROM comprobantes GROUP BY Tipo'),
      10_000,
      'tipos comprobante Quantio'
    );
    const salida: string[] = [];
    const devolucion: string[] = [];
    for (const r of rows as Array<{ Tipo: string | null; op: number | string | null }>) {
      const tipo = String(r.Tipo ?? '').trim();
      const op = Number(r.op ?? 0);
      if (!tipo || !Number.isFinite(op) || op === 0) continue;
      if (op < 0) salida.push(tipo);
      else devolucion.push(tipo);
    }
    if (salida.length === 0) return fallback;
    const valor = { salida, devolucion };
    tiposCache = { valor, expiraEn: ahora + TIPOS_CACHE_TTL_MS };
    return valor;
  } catch (e) {
    console.warn(
      '[ventas-legacy] No se pudo leer comprobantes de Quantio, se usan tipos por defecto:',
      e instanceof Error ? e.message : String(e)
    );
    return fallback;
  }
}

function buildSqlVentas(cantidadTiposDevolucion: number): string {
  const signo =
    cantidadTiposDevolucion > 0
      ? `SUM(CASE WHEN fc.Tipo IN (?) THEN -fl.Cantidad ELSE fl.Cantidad END)`
      : `SUM(fl.Cantidad)`;
  return `
    SELECT
      fl.IDProducto AS producto_id,
      DATE_FORMAT(fc.Emision, '%Y-%m-%d') AS fecha,
      ${signo} AS cantidad
    FROM factlineas fl
    INNER JOIN factcabecera fc ON fc.IDComprobante = fl.IDComprobante
    WHERE fc.Sucursal = ?
      AND fl.IDProducto IN (?)
      AND COALESCE(fl.TipoCantidad, 'C') = 'C'
      AND COALESCE(fl.NoMueveStock, 0) = 0
      AND fc.Tipo IN (?)
      AND COALESCE(fc.Estado, '') <> '${ESTADO_CANCELADO}'
      AND fc.Emision >= ?
    GROUP BY fl.IDProducto, fc.Emision
  `;
}

export async function getVentasDiariasQuantio(
  query: VentasLegacyQuery
): Promise<VentasLegacyResult> {
  const t0 = Date.now();
  const lotes = chunkProductoIds(query.productoIds);
  if (lotes.length === 0) {
    return { ok: true, ventas: [], latencyMs: 0 };
  }

  if (!isQuantioDatabaseConfigured()) {
    return {
      ok: false,
      status: 'unconfigured',
      latencyMs: Date.now() - t0,
      error: 'MySQL Quantio no configurado',
    };
  }

  const tipos = await getTiposMovimientoStock();
  const tiposTodos = [...tipos.salida, ...tipos.devolucion];
  const sql = buildSqlVentas(tipos.devolucion.length);
  const ventas: VentaDiariaProducto[] = [];

  try {
    const pool = getQuantioPool();
    for (const lote of lotes) {
      const params: unknown[] = [];
      if (tipos.devolucion.length > 0) params.push(tipos.devolucion);
      params.push(query.sucursalLegacyId, lote, tiposTodos, query.desdeFecha);

      const [rows] = await conTimeout(
        pool.query(sql, params),
        ventasQueryTimeoutMs(),
        'ventas Quantio'
      );
      for (const r of rows as Array<{ producto_id: number; fecha: string; cantidad: number | string }>) {
        const cantidad = Number(r.cantidad ?? 0);
        if (!Number.isFinite(cantidad) || cantidad === 0) continue;
        ventas.push({
          productoId: Number(r.producto_id),
          fecha: String(r.fecha),
          cantidad,
        });
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[ventas-legacy] Quantio:', error);
    return {
      ok: false,
      status: clasificarErrorVentasLegacy(error),
      latencyMs: Date.now() - t0,
      error,
    };
  }

  return { ok: true, ventas, latencyMs: Date.now() - t0 };
}
