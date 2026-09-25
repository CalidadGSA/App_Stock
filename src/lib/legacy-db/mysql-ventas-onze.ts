/**
 * Ventas por producto en Onze (farmacias), desde factcabecera + factlineas.
 *
 * Tipos de comprobante verificados contra stockmovimientos: FV (factura), TF (ticket factura)
 * y TK (ticket) son los que descuentan stock; NC (nota de crédito) lo devuelve y por eso resta.
 * Se cuentan solo cajas (TipoCantidad = 'C'), que es la unidad con la que se cargan los
 * controles de vencimientos.
 */

import { getOnzePool, queryStockmovimientosHealthCheck } from '@/lib/legacy-db/mysql-stock';
import {
  chunkProductoIds,
  clasificarErrorVentasLegacy,
  conTimeout,
  type VentaDiariaProducto,
  type VentasLegacyQuery,
  type VentasLegacyResult,
} from '@/lib/legacy-db/ventas-legacy-types';

const DEFAULT_VENTAS_QUERY_TIMEOUT_MS = 45_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;

/** Comprobantes que sacan mercadería del stock. */
export const ONZE_TIPOS_SALIDA = ['FV', 'TF', 'TK'] as const;
/** Comprobantes que la devuelven (restan de lo vendido). */
export const ONZE_TIPOS_DEVOLUCION = ['NC'] as const;

function readEnvMs(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ventasQueryTimeoutMs(): number {
  const propio = parseInt(process.env.ONZE_VENTAS_QUERY_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(propio) && propio > 0) return propio;
  return readEnvMs('ONZE_VENTA_POSTERIOR_TIMEOUT_MS', DEFAULT_VENTAS_QUERY_TIMEOUT_MS);
}

const SQL_VENTAS = `
  SELECT
    fl.IDProducto AS producto_id,
    DATE_FORMAT(fc.Emision, '%Y-%m-%d') AS fecha,
    SUM(CASE WHEN fc.Tipo = 'NC' THEN -fl.Cantidad ELSE fl.Cantidad END) AS cantidad
  FROM factlineas fl
  INNER JOIN factcabecera fc ON fc.IDComprobante = fl.IDComprobante
  WHERE fc.Sucursal = ?
    AND fl.IDProducto IN (?)
    AND fl.TipoCantidad = 'C'
    AND fc.Tipo IN (?)
    AND fc.Emision >= ?
  GROUP BY fl.IDProducto, fc.Emision
`;

export async function getVentasDiariasOnze(query: VentasLegacyQuery): Promise<VentasLegacyResult> {
  const t0 = Date.now();
  const lotes = chunkProductoIds(query.productoIds);
  if (lotes.length === 0) {
    return { ok: true, ventas: [], latencyMs: 0 };
  }

  // Ping liviano: solo para distinguir «base caída» de «base lenta».
  const health = await queryStockmovimientosHealthCheck(
    readEnvMs('ONZE_DB_HEALTH_TIMEOUT_MS', DEFAULT_HEALTH_TIMEOUT_MS)
  );
  if (!health.ok) {
    return {
      ok: false,
      status: clasificarErrorVentasLegacy(health.error),
      latencyMs: Date.now() - t0,
      error: health.error,
    };
  }

  const pool = await getOnzePool();
  if (!pool) {
    return {
      ok: false,
      status: 'unconfigured',
      latencyMs: Date.now() - t0,
      error: 'MySQL Onze no configurado',
    };
  }

  const tipos = [...ONZE_TIPOS_SALIDA, ...ONZE_TIPOS_DEVOLUCION];
  const ventas: VentaDiariaProducto[] = [];

  type FilaVenta = { producto_id: number; fecha: string; cantidad: number | string };

  try {
    for (const lote of lotes) {
      const consulta = pool.query(SQL_VENTAS, [
        query.sucursalLegacyId,
        lote,
        tipos,
        query.desdeFecha,
      ]) as Promise<[FilaVenta[], unknown]>;
      const [rows] = await conTimeout(consulta, ventasQueryTimeoutMs(), 'ventas Onze');
      for (const r of rows) {
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
    console.error('[ventas-legacy] Onze:', error);
    return {
      ok: false,
      status: clasificarErrorVentasLegacy(error),
      latencyMs: Date.now() - t0,
      error,
    };
  }

  return { ok: true, ventas, latencyMs: Date.now() - t0 };
}
