/**
 * PVP de referencia por producto: `plexdr.productoscostos.PrecioAlfabeta` de la fila más
 * reciente (mayor `Fecha`) de cada `IDProducto`.
 *
 * `productoscostos` guarda el historial de listas (una fila por producto y mes, `TipoLista = 'P'`),
 * así que "el precio vigente" es el de la última fecha cargada. Solo servidor.
 */

import { getQuantioPool, isQuantioDatabaseConfigured } from '@/lib/legacy-db/quantio-mysql';
import { conTimeout } from '@/lib/legacy-db/ventas-legacy-types';

/** Los precios cambian por lista mensual: un cache corto evita repetir la consulta al paginar. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Ids por consulta (la lista va en el IN). */
const CHUNK_IDS = 500;

type CacheEntry = { precio: number | null; expiresAt: number };

declare const globalThis: { __plexdrPreciosCache?: Map<string, CacheEntry> };

function cache(): Map<string, CacheEntry> {
  if (!globalThis.__plexdrPreciosCache) globalThis.__plexdrPreciosCache = new Map();
  return globalThis.__plexdrPreciosCache;
}

function timeoutMs(): number {
  const n = parseInt(process.env.PLEXDR_PRECIOS_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** Última fila por producto; `MAX(PrecioAlfabeta)` desempata si hubiera varias listas esa fecha. */
const SQL_PRECIOS = `
  SELECT pc.IDProducto AS id, MAX(pc.PrecioAlfabeta) AS precio
  FROM productoscostos pc
  INNER JOIN (
    SELECT IDProducto, MAX(Fecha) AS ultima
    FROM productoscostos
    WHERE IDProducto IN (?)
    GROUP BY IDProducto
  ) u ON u.IDProducto = pc.IDProducto AND u.ultima = pc.Fecha
  WHERE pc.IDProducto IN (?)
  GROUP BY pc.IDProducto
`;

export type PreciosAlfabetaResult = {
  /** producto_id (string) → PVP vigente. Solo entradas con precio > 0. */
  precios: Map<string, number>;
  /** false si plexdr no está configurado o no respondió (el llamador puede usar su fallback). */
  ok: boolean;
  error?: string;
};

/**
 * PVP vigente (PrecioAlfabeta) de los productos pedidos.
 * Nunca lanza: ante un fallo devuelve `ok: false` y lo ya cacheado.
 */
export async function getPreciosAlfabetaPlexdr(
  ids: Array<number | string | null | undefined>
): Promise<PreciosAlfabetaResult> {
  const precios = new Map<string, number>();

  const unicos = Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    )
  );
  if (unicos.length === 0) return { precios, ok: true };

  const ahora = Date.now();
  const pendientes: number[] = [];
  for (const id of unicos) {
    const hit = cache().get(String(id));
    if (hit && hit.expiresAt > ahora) {
      if (hit.precio != null) precios.set(String(id), hit.precio);
      continue;
    }
    pendientes.push(id);
  }
  if (pendientes.length === 0) return { precios, ok: true };

  if (!isQuantioDatabaseConfigured()) {
    return { precios, ok: false, error: 'plexdr (QUANTIO_DB_*) no configurado' };
  }

  try {
    const pool = getQuantioPool();
    for (let i = 0; i < pendientes.length; i += CHUNK_IDS) {
      const lote = pendientes.slice(i, i + CHUNK_IDS);
      const consulta = pool.query(SQL_PRECIOS, [lote, lote]) as Promise<
        [Array<{ id: number; precio: number | string | null }>, unknown]
      >;
      const [rows] = await conTimeout(consulta, timeoutMs(), 'plexdr precios');

      const conDato = new Set<string>();
      for (const r of rows) {
        const id = String(Number(r.id));
        const precio = Number(r.precio ?? 0);
        conDato.add(id);
        if (Number.isFinite(precio) && precio > 0) {
          precios.set(id, precio);
          cache().set(id, { precio, expiresAt: Date.now() + CACHE_TTL_MS });
        } else {
          cache().set(id, { precio: null, expiresAt: Date.now() + CACHE_TTL_MS });
        }
      }
      // Productos sin fila en productoscostos: se recuerdan para no volver a pedirlos.
      for (const id of lote) {
        if (!conDato.has(String(id))) {
          cache().set(String(id), { precio: null, expiresAt: Date.now() + CACHE_TTL_MS });
        }
      }
    }
    return { precios, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn('[plexdr precios] PrecioAlfabeta no disponible:', error);
    return { precios, ok: false, error };
  }
}
