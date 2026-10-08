/**
 * Consultas a onze_center para los KPIs mensuales de sucursal (solo servidor).
 *
 *  - Bajas/altas de stock por motivo: `stock_operaciones` + `stock_operaciones_detalle`
 *    + `stock_operaciones_motivos`. `Cantidad` siempre es positiva; el signo lo da
 *    `motivos.alta_baja` ('A' suma stock, 'B' lo resta). Costo y Precio vienen por línea
 *    (valores al momento de la operación); si la línea no trae costo se usa `Precio × 0,65`
 *    (ver `sqlCostoConFallback`), porque ~1 de cada 3 líneas viene con costo NULL o 0.
 *  - Facturación: `factcabecera` FV/TF/TK menos notas de crédito **vinculadas** a esos
 *    comprobantes (`factlineas.RefIDGlobal` → `factcabecera.IDGlobal`). Las NC sin
 *    referencia (débitos/recuperos de obras sociales) no descuentan ventas de mostrador.
 *  - Stock valorizado: `stock` × costo. Se devuelve a costo de lista (`medicamentos.Costo`,
 *    misma base con la que la app valoriza las diferencias) y a costo PPP
 *    (`stock.costoPPP` → `UltimoCosto` → `medicamentos.Costo`). En ambos casos el costo de
 *    `medicamentos` aplica la misma regla de fallback por precio.
 *
 *  - Vales: `factlineasptesentrega`, una fila por producto que la sucursal quedó debiendo.
 *    `SucOrigen` es la sucursal que lo generó y `FechaHoraFactura` cuándo se generó.
 *
 * Fechas: `FechaHora`/`Emision` en onze_center son hora local de la sucursal (AR); se
 * comparan con `YYYY-MM-DD` del mes calendario, sin conversión UTC.
 */

import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import { sqlCostoConFallback } from '@/lib/legacy-db/onze-medicamentos';
import { ONZE_TIPOS_SALIDA } from '@/lib/legacy-db/mysql-ventas-onze';
import { conTimeout } from '@/lib/legacy-db/ventas-legacy-types';

const DEFAULT_TIMEOUT_MS = 20_000;

function timeoutMs(): number {
  const n = parseInt(process.env.ONZE_KPIS_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export type OnzeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface BajaPorMotivo {
  motivo_id: number;
  descripcion: string;
  /** 'A' alta (suma stock) / 'B' baja (resta stock). */
  alta_baja: 'A' | 'B';
  operaciones: number;
  lineas: number;
  cajas: number;
  unidades: number;
  /** Σ (cajas + unidades/unidadesProducto) × Costo de la línea. */
  valor_costo: number;
  /** Σ (cajas + unidades/unidadesProducto) × Precio (PVP) de la línea. */
  valor_pvp: number;
}

export interface FacturacionMes {
  /** Σ TotalComprobante de FV/TF/TK. */
  ventas_brutas: number;
  comprobantes: number;
  /** Σ Total de líneas de NC que referencian un FV/TF/TK. */
  notas_credito: number;
  notas_credito_comprobantes: number;
  /** ventas_brutas − notas_credito. */
  neta: number;
}

export interface StockValorizado {
  productos: number;
  cajas: number;
  /** Cajas (+ fracción de unidades sueltas) × medicamentos.Costo. */
  valor_costo: number;
  /** Cajas (+ fracción) × costoPPP → UltimoCosto → medicamentos.Costo. */
  valor_ppp: number;
}

type Pool = NonNullable<Awaited<ReturnType<typeof getOnzePool>>>;

async function pool(): Promise<OnzeResult<Pool>> {
  const p = await getOnzePool();
  if (!p) return { ok: false, error: 'MySQL Onze no configurado' };
  return { ok: true, data: p };
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Cantidad total en cajas: cajas + unidades sueltas / unidades por caja (solo si el dato es válido). */
const SQL_CAJAS_EQUIV_DETALLE =
  '(d.Cantidad + CASE WHEN d.UnidadesProducto > 0 AND d.Unidades > 0 THEN d.Unidades / d.UnidadesProducto ELSE 0 END)';

export async function queryBajasPorMotivo(
  sucursalId: number,
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<BajaPorMotivo[]>> {
  const p = await pool();
  if (!p.ok) return p;
  try {
    const q = p.data.query(
      `SELECT
         m.idMotivoOpStock AS motivo_id,
         m.descripcion,
         m.alta_baja,
         COUNT(DISTINCT o.IDOperacion) AS operaciones,
         COUNT(*) AS lineas,
         SUM(d.Cantidad) AS cajas,
         SUM(d.Unidades) AS unidades,
         SUM(${SQL_CAJAS_EQUIV_DETALLE} * ${sqlCostoConFallback('d.Costo', 'd.Precio')}) AS valor_costo,
         SUM(${SQL_CAJAS_EQUIV_DETALLE} * COALESCE(d.Precio, 0)) AS valor_pvp
       FROM stock_operaciones o
       INNER JOIN stock_operaciones_detalle d ON d.IDOperacion = o.IDOperacion
       INNER JOIN stock_operaciones_motivos m ON m.idMotivoOpStock = o.idMotivoOpStock
       WHERE o.Sucursal = ?
         AND o.FechaHora >= ?
         AND o.FechaHora < ?
       GROUP BY m.idMotivoOpStock, m.descripcion, m.alta_baja
       ORDER BY m.alta_baja, valor_costo DESC`,
      [sucursalId, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze bajas por motivo');
    return {
      ok: true,
      data: rows.map((r) => ({
        motivo_id: num(r.motivo_id),
        descripcion: String(r.descripcion ?? '').trim() || `Motivo ${num(r.motivo_id)}`,
        alta_baja: String(r.alta_baja ?? 'B').toUpperCase() === 'A' ? 'A' : 'B',
        operaciones: num(r.operaciones),
        lineas: num(r.lineas),
        cajas: num(r.cajas),
        unidades: num(r.unidades),
        valor_costo: num(r.valor_costo),
        valor_pvp: num(r.valor_pvp),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function queryFacturacionMes(
  sucursalId: number,
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<FacturacionMes>> {
  const p = await pool();
  if (!p.ok) return p;
  const tipos = [...ONZE_TIPOS_SALIDA];
  try {
    const qVentas = p.data.query(
      `SELECT COUNT(*) AS comprobantes, SUM(fc.TotalComprobante) AS total
       FROM factcabecera fc
       WHERE fc.Sucursal = ? AND fc.Tipo IN (?) AND fc.Emision >= ? AND fc.Emision < ?`,
      [sucursalId, tipos, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    // NC en el mes que referencian una venta de mostrador (aunque la venta sea de otro mes).
    const qNc = p.data.query(
      `SELECT COUNT(DISTINCT fc.IDComprobante) AS comprobantes, SUM(fl.Total) AS total
       FROM factlineas fl
       INNER JOIN factcabecera fc ON fc.IDComprobante = fl.IDComprobante
       INNER JOIN factcabecera r ON r.IDGlobal = fl.RefIDGlobal AND r.Tipo IN (?)
       WHERE fc.Tipo = 'NC' AND fc.Sucursal = ? AND fc.Emision >= ? AND fc.Emision < ?`,
      [tipos, sucursalId, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [[ventas], [nc]] = await conTimeout(
      Promise.all([qVentas, qNc]),
      timeoutMs(),
      'Onze facturación'
    );
    const brutas = num(ventas[0]?.total);
    const notas = num(nc[0]?.total);
    return {
      ok: true,
      data: {
        ventas_brutas: brutas,
        comprobantes: num(ventas[0]?.comprobantes),
        notas_credito: notas,
        notas_credito_comprobantes: num(nc[0]?.comprobantes),
        neta: brutas - notas,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const SQL_CAJAS_EQUIV_STOCK =
  '(s.Cantidad + CASE WHEN s.UnidadesProd > 0 AND s.Unidades > 0 THEN s.Unidades / s.UnidadesProd ELSE 0 END)';

/** Stock actual valorizado (solo existencias positivas; los negativos son errores de carga). */
export async function queryStockValorizado(
  sucursalIds: number[]
): Promise<OnzeResult<Map<number, StockValorizado>>> {
  const p = await pool();
  if (!p.ok) return p;
  if (sucursalIds.length === 0) return { ok: true, data: new Map() };
  try {
    const q = p.data.query(
      `SELECT
         s.Sucursal AS sucursal_id,
         COUNT(*) AS productos,
         SUM(s.Cantidad) AS cajas,
         SUM(${SQL_CAJAS_EQUIV_STOCK} * ${sqlCostoConFallback('m.Costo', 'm.Precio')}) AS valor_costo,
         SUM(${SQL_CAJAS_EQUIV_STOCK} * COALESCE(NULLIF(s.costoPPP, 0), NULLIF(s.UltimoCosto, 0), ${sqlCostoConFallback('m.Costo', 'm.Precio')})) AS valor_ppp
       FROM stock s
       LEFT JOIN medicamentos m ON m.CodPlex = s.IDProducto
       WHERE s.Sucursal IN (?) AND s.Cantidad > 0
       GROUP BY s.Sucursal`,
      [sucursalIds]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze stock valorizado');
    const out = new Map<number, StockValorizado>();
    for (const r of rows) {
      out.set(num(r.sucursal_id), {
        productos: num(r.productos),
        cajas: num(r.cajas),
        valor_costo: num(r.valor_costo),
        valor_ppp: num(r.valor_ppp),
      });
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ValesMes {
  /** Comprobantes distintos con al menos una línea pendiente de entrega generada en el mes. */
  vales: number;
  lineas: number;
  unidades: number;
  /** Vales que todavía tienen alguna línea sin entregar. */
  vales_pendientes: number;
  lineas_entregadas: number;
  lineas_pendientes: number;
  lineas_canceladas: number;
}

/**
 * Vales (pendientes de entrega) generados por la sucursal en el mes.
 *
 * `factlineasptesentrega` guarda una fila por producto que quedó debiendo la sucursal:
 * `SucOrigen` es quien lo generó y `FechaHoraFactura` cuándo. El vale es el comprobante,
 * así que la cantidad de vales son comprobantes distintos, no líneas.
 * `Estado`: E entregado, P pendiente, C cancelado.
 */
export async function queryValesMes(
  sucursalId: number,
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<ValesMes>> {
  const p = await pool();
  if (!p.ok) return p;
  try {
    const q = p.data.query(
      `SELECT
         COUNT(DISTINCT IDComprobante) AS vales,
         COUNT(*) AS lineas,
         SUM(Cantidad) AS unidades,
         COUNT(DISTINCT CASE WHEN Estado = 'P' THEN IDComprobante END) AS vales_pendientes,
         SUM(Estado = 'E') AS lineas_entregadas,
         SUM(Estado = 'P') AS lineas_pendientes,
         SUM(Estado = 'C') AS lineas_canceladas
       FROM factlineasptesentrega
       WHERE SucOrigen = ? AND FechaHoraFactura >= ? AND FechaHoraFactura < ?`,
      [sucursalId, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze vales del mes');
    const r = rows[0] ?? {};
    return {
      ok: true,
      data: {
        vales: num(r.vales),
        lineas: num(r.lineas),
        unidades: num(r.unidades),
        vales_pendientes: num(r.vales_pendientes),
        lineas_entregadas: num(r.lineas_entregadas),
        lineas_pendientes: num(r.lineas_pendientes),
        lineas_canceladas: num(r.lineas_canceladas),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Vales generados por varias sucursales en un período, en una sola consulta.
 * Para los informes mensual y trimestral, que recorren todas las sucursales.
 */
export async function queryValesPorSucursal(
  sucursalIds: number[],
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<Map<number, ValesMes>>> {
  const p = await pool();
  if (!p.ok) return p;
  if (sucursalIds.length === 0) return { ok: true, data: new Map() };
  try {
    const q = p.data.query(
      `SELECT
         SucOrigen AS sucursal_id,
         COUNT(DISTINCT IDComprobante) AS vales,
         COUNT(*) AS lineas,
         SUM(Cantidad) AS unidades,
         COUNT(DISTINCT CASE WHEN Estado = 'P' THEN IDComprobante END) AS vales_pendientes,
         SUM(Estado = 'E') AS lineas_entregadas,
         SUM(Estado = 'P') AS lineas_pendientes,
         SUM(Estado = 'C') AS lineas_canceladas
       FROM factlineasptesentrega
       WHERE SucOrigen IN (?) AND FechaHoraFactura >= ? AND FechaHoraFactura < ?
       GROUP BY SucOrigen`,
      [sucursalIds, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze vales por sucursal');

    const out = new Map<number, ValesMes>();
    for (const r of rows) {
      out.set(num(r.sucursal_id), {
        vales: num(r.vales),
        lineas: num(r.lineas),
        unidades: num(r.unidades),
        vales_pendientes: num(r.vales_pendientes),
        lineas_entregadas: num(r.lineas_entregadas),
        lineas_pendientes: num(r.lineas_pendientes),
        lineas_canceladas: num(r.lineas_canceladas),
      });
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const VALES_VACIO: ValesMes = {
  vales: 0,
  lineas: 0,
  unidades: 0,
  vales_pendientes: 0,
  lineas_entregadas: 0,
  lineas_pendientes: 0,
  lineas_canceladas: 0,
};

/**
 * Vales generados por mes, sumando todas las sucursales indicadas. Para el gráfico de
 * tendencia del informe mensual: una sola consulta cubre todos los meses de la serie.
 */
export async function queryValesPorMes(
  sucursalIds: number[],
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<Map<string, ValesMes>>> {
  const p = await pool();
  if (!p.ok) return p;
  if (sucursalIds.length === 0) return { ok: true, data: new Map() };
  try {
    const q = p.data.query(
      `SELECT
         DATE_FORMAT(FechaHoraFactura, '%Y-%m') AS ym,
         COUNT(DISTINCT IDComprobante) AS vales,
         COUNT(*) AS lineas,
         SUM(Cantidad) AS unidades,
         COUNT(DISTINCT CASE WHEN Estado = 'P' THEN IDComprobante END) AS vales_pendientes,
         SUM(Estado = 'E') AS lineas_entregadas,
         SUM(Estado = 'P') AS lineas_pendientes,
         SUM(Estado = 'C') AS lineas_canceladas
       FROM factlineasptesentrega
       WHERE SucOrigen IN (?) AND FechaHoraFactura >= ? AND FechaHoraFactura < ?
       GROUP BY DATE_FORMAT(FechaHoraFactura, '%Y-%m')`,
      [sucursalIds, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze vales por mes');

    const out = new Map<string, ValesMes>();
    for (const r of rows) {
      out.set(String(r.ym ?? ''), {
        vales: num(r.vales),
        lineas: num(r.lineas),
        unidades: num(r.unidades),
        vales_pendientes: num(r.vales_pendientes),
        lineas_entregadas: num(r.lineas_entregadas),
        lineas_pendientes: num(r.lineas_pendientes),
        lineas_canceladas: num(r.lineas_canceladas),
      });
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bajas/altas por motivo de varias sucursales, en una sola consulta (para el tablero). */
export async function queryBajasPorSucursalYMotivo(
  sucursalIds: number[],
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<Map<number, BajaPorMotivo[]>>> {
  const p = await pool();
  if (!p.ok) return p;
  if (sucursalIds.length === 0) return { ok: true, data: new Map() };
  try {
    const q = p.data.query(
      `SELECT
         o.Sucursal AS sucursal_id,
         m.idMotivoOpStock AS motivo_id,
         m.descripcion,
         m.alta_baja,
         COUNT(DISTINCT o.IDOperacion) AS operaciones,
         COUNT(*) AS lineas,
         SUM(d.Cantidad) AS cajas,
         SUM(d.Unidades) AS unidades,
         SUM(${SQL_CAJAS_EQUIV_DETALLE} * ${sqlCostoConFallback('d.Costo', 'd.Precio')}) AS valor_costo,
         SUM(${SQL_CAJAS_EQUIV_DETALLE} * COALESCE(d.Precio, 0)) AS valor_pvp
       FROM stock_operaciones o
       INNER JOIN stock_operaciones_detalle d ON d.IDOperacion = o.IDOperacion
       INNER JOIN stock_operaciones_motivos m ON m.idMotivoOpStock = o.idMotivoOpStock
       WHERE o.Sucursal IN (?) AND o.FechaHora >= ? AND o.FechaHora < ?
       GROUP BY o.Sucursal, m.idMotivoOpStock, m.descripcion, m.alta_baja`,
      [sucursalIds, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(q, timeoutMs(), 'Onze bajas por sucursal');

    const out = new Map<number, BajaPorMotivo[]>();
    for (const r of rows) {
      const suc = num(r.sucursal_id);
      const lista = out.get(suc) ?? [];
      lista.push({
        motivo_id: num(r.motivo_id),
        descripcion: String(r.descripcion ?? '').trim() || `Motivo ${num(r.motivo_id)}`,
        alta_baja: String(r.alta_baja ?? 'B').toUpperCase() === 'A' ? 'A' : 'B',
        operaciones: num(r.operaciones),
        lineas: num(r.lineas),
        cajas: num(r.cajas),
        unidades: num(r.unidades),
        valor_costo: num(r.valor_costo),
        valor_pvp: num(r.valor_pvp),
      });
      out.set(suc, lista);
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Facturación neta de varias sucursales, en una sola consulta (para el tablero). */
export async function queryFacturacionPorSucursal(
  sucursalIds: number[],
  desdeYmd: string,
  hastaExclusivoYmd: string
): Promise<OnzeResult<Map<number, FacturacionMes>>> {
  const p = await pool();
  if (!p.ok) return p;
  if (sucursalIds.length === 0) return { ok: true, data: new Map() };
  try {
    const tipos = ONZE_TIPOS_SALIDA;
    const qVentas = p.data.query(
      `SELECT Sucursal AS sucursal_id, COUNT(*) AS comprobantes, SUM(TotalComprobante) AS total
       FROM factcabecera
       WHERE Tipo IN (?) AND Sucursal IN (?) AND Emision >= ? AND Emision < ?
       GROUP BY Sucursal`,
      [tipos, sucursalIds, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;

    const qNc = p.data.query(
      `SELECT fc.Sucursal AS sucursal_id,
              COUNT(DISTINCT fc.IDComprobante) AS comprobantes,
              SUM(fl.Total) AS total
       FROM factlineas fl
       INNER JOIN factcabecera fc ON fc.IDComprobante = fl.IDComprobante
       INNER JOIN factcabecera r ON r.IDGlobal = fl.RefIDGlobal AND r.Tipo IN (?)
       WHERE fc.Tipo = 'NC' AND fc.Sucursal IN (?) AND fc.Emision >= ? AND fc.Emision < ?
       GROUP BY fc.Sucursal`,
      [tipos, sucursalIds, desdeYmd, hastaExclusivoYmd]
    ) as Promise<[Array<Record<string, unknown>>, unknown]>;

    const [[ventas], [ncs]] = await conTimeout(
      Promise.all([qVentas, qNc]),
      timeoutMs(),
      'Onze facturación por sucursal'
    );

    const out = new Map<number, FacturacionMes>();
    for (const r of ventas) {
      const suc = num(r.sucursal_id);
      out.set(suc, {
        ventas_brutas: num(r.total),
        comprobantes: num(r.comprobantes),
        notas_credito: 0,
        notas_credito_comprobantes: 0,
        neta: num(r.total),
      });
    }
    for (const r of ncs) {
      const suc = num(r.sucursal_id);
      const actual = out.get(suc) ?? {
        ventas_brutas: 0,
        comprobantes: 0,
        notas_credito: 0,
        notas_credito_comprobantes: 0,
        neta: 0,
      };
      actual.notas_credito = num(r.total);
      actual.notas_credito_comprobantes = num(r.comprobantes);
      actual.neta = actual.ventas_brutas - actual.notas_credito;
      out.set(suc, actual);
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
