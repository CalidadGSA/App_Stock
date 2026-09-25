/**
 * Datos de producto desde `onze_center.medicamentos` (en vivo, no la copia de Supabase, que el
 * sync deja desactualizada en parte del catálogo): costo por caja y unidades por caja.
 *
 * Regla de costo acordada con operación: se usa `Costo`; si viene NULL o en 0, se deriva del
 * precio de venta (`Precio × 0,65`). En `stock_operaciones_detalle` pasa lo mismo y por eso el
 * factor vive acá (ver `FACTOR_COSTO_DESDE_PRECIO`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import { conTimeout } from '@/lib/legacy-db/ventas-legacy-types';

/** Costo estimado = precio de venta × este factor, cuando no hay costo cargado. */
export const FACTOR_COSTO_DESDE_PRECIO = 0.65;

/**
 * SQL reutilizable: costo con el fallback por precio.
 * `NULLIF(x, 0)` deja fuera tanto el NULL como el 0 (ambos significan "sin costo cargado").
 */
export function sqlCostoConFallback(costoExpr: string, precioExpr: string): string {
  return `COALESCE(NULLIF(${costoExpr}, 0), NULLIF(${precioExpr}, 0) * ${FACTOR_COSTO_DESDE_PRECIO}, 0)`;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const CHUNK_IDS = 500;

/** Unidades por envase cuando el catálogo no lo informa (producto no fraccionable). */
export const UNIDADES_POR_CAJA_DEFAULT = 1;

export type DatosMedicamentoOnze = {
  /** Costo de la caja/envase. */
  costo: number | null;
  /** `medicamentos.Unidades`: cuántas unidades trae la caja (1 si no es fraccionable). */
  unidadesPorCaja: number;
};

type CacheEntry = DatosMedicamentoOnze & { expiresAt: number };

function cache(): Map<string, CacheEntry> {
  if (!globalThis.__onzeMedicamentosCache) globalThis.__onzeMedicamentosCache = new Map();
  return globalThis.__onzeMedicamentosCache;
}

function timeoutMs(): number {
  const n = parseInt(process.env.ONZE_COSTOS_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

const SQL_DATOS = `
  SELECT CodPlex AS id,
         ${sqlCostoConFallback('Costo', 'Precio')} AS costo,
         Unidades AS unidades_por_caja
  FROM medicamentos
  WHERE CodPlex IN (?)
`;

export type DatosMedicamentosOnzeResult = {
  /** producto_id (string) → costo y unidades por caja. */
  datos: Map<string, DatosMedicamentoOnze>;
  /** false si Onze no respondió (el llamador puede usar su fallback). */
  ok: boolean;
  error?: string;
};

/**
 * Costo y unidades por caja de los productos pedidos.
 * Nunca lanza: ante un fallo devuelve `ok: false`.
 */
export async function getDatosMedicamentosOnze(
  ids: Array<number | string | null | undefined>
): Promise<DatosMedicamentosOnzeResult> {
  const datos = new Map<string, DatosMedicamentoOnze>();

  const unicos = Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    )
  );
  if (unicos.length === 0) return { datos, ok: true };

  const ahora = Date.now();
  const pendientes: number[] = [];
  for (const id of unicos) {
    const hit = cache().get(String(id));
    if (hit && hit.expiresAt > ahora) {
      datos.set(String(id), { costo: hit.costo, unidadesPorCaja: hit.unidadesPorCaja });
      continue;
    }
    pendientes.push(id);
  }
  if (pendientes.length === 0) return { datos, ok: true };

  try {
    const pool = await getOnzePool();
    if (!pool) return { datos, ok: false, error: 'MySQL Onze no configurado' };

    for (let i = 0; i < pendientes.length; i += CHUNK_IDS) {
      const lote = pendientes.slice(i, i + CHUNK_IDS);
      const consulta = pool.query(SQL_DATOS, [lote]) as Promise<
        [
          Array<{
            id: number;
            costo: number | string | null;
            unidades_por_caja: number | string | null;
          }>,
          unknown,
        ]
      >;
      const [rows] = await conTimeout(consulta, timeoutMs(), 'Onze medicamentos');

      const conDato = new Set<string>();
      for (const r of rows) {
        const id = String(Number(r.id));
        conDato.add(id);
        const costoNum = Number(r.costo ?? 0);
        const upcNum = Number(r.unidades_por_caja ?? 0);
        const entrada: DatosMedicamentoOnze = {
          costo: Number.isFinite(costoNum) && costoNum > 0 ? costoNum : null,
          unidadesPorCaja:
            Number.isFinite(upcNum) && upcNum > 0 ? upcNum : UNIDADES_POR_CAJA_DEFAULT,
        };
        datos.set(id, entrada);
        cache().set(id, { ...entrada, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      for (const id of lote) {
        if (!conDato.has(String(id))) {
          cache().set(String(id), {
            costo: null,
            unidadesPorCaja: UNIDADES_POR_CAJA_DEFAULT,
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        }
      }
    }
    return { datos, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn('[onze medicamentos] dato no disponible:', error);
    return { datos, ok: false, error };
  }
}

/** Solo los costos (para los llamadores que no necesitan las unidades). */
export async function getCostosMedicamentosOnze(
  ids: Array<number | string | null | undefined>
): Promise<{ costos: Map<string, number>; ok: boolean; error?: string }> {
  const { datos, ok, error } = await getDatosMedicamentosOnze(ids);
  const costos = new Map<string, number>();
  for (const [id, d] of datos) if (d.costo != null) costos.set(id, d.costo);
  return { costos, ok, error };
}

/** Unidades por caja (`medicamentos.Unidades`), para valorizar fraccionados. */
export async function getUnidadesPorCajaOnze(
  ids: Array<number | string | null | undefined>
): Promise<Map<string, number>> {
  const { datos } = await getDatosMedicamentosOnze(ids);
  const map = new Map<string, number>();
  for (const [id, d] of datos) map.set(id, d.unidadesPorCaja);
  return map;
}

/**
 * Ficha de producto con los campos que la app venía leyendo de la copia de `medicamentos`
 * en Supabase. Las claves van en minúscula, igual que esa copia, para que los consumidores
 * no tengan que cambiar la forma de los datos.
 */
export type FichaMedicamentoOnze = {
  codplex: string;
  producto: string | null;
  presentaci: string | null;
  codebar: string | null;
  troquel: number | null;
  codlab: number | null;
  idsubrubro: number | null;
  idpsicofarmaco: string | null;
  fraccionable: number | null;
  /** `medicamentos.Unidades` (unidades por caja). */
  unidades: number;
};

type CacheFicha = { ficha: FichaMedicamentoOnze | null; expiresAt: number };
type CacheCodebars = { codebars: string[]; expiresAt: number };

declare const globalThis: {
  __onzeMedicamentosCache?: Map<string, CacheEntry>;
  __onzeFichasCache?: Map<string, CacheFicha>;
  __onzeCodebarsCache?: Map<string, CacheCodebars>;
};

function cacheFichas(): Map<string, CacheFicha> {
  if (!globalThis.__onzeFichasCache) globalThis.__onzeFichasCache = new Map();
  return globalThis.__onzeFichasCache;
}

function cacheCodebars(): Map<string, CacheCodebars> {
  if (!globalThis.__onzeCodebarsCache) globalThis.__onzeCodebarsCache = new Map();
  return globalThis.__onzeCodebarsCache;
}

const SQL_FICHAS = `
  SELECT CodPlex AS codplex,
         Producto AS producto,
         Presentaci AS presentaci,
         codebar,
         Troquel AS troquel,
         CodLab AS codlab,
         IDSubRubro AS idsubrubro,
         IDPsicofarmaco AS idpsicofarmaco,
         Fraccionable AS fraccionable,
         Unidades AS unidades
  FROM medicamentos
  WHERE CodPlex IN (?)
`;

function numeroONull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoONull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

/**
 * Fichas de producto desde `onze_center.medicamentos` (en vivo).
 * Nunca lanza: si Onze no responde devuelve `ok: false` y el mapa vacío.
 */
export async function getFichasMedicamentoOnze(
  ids: Array<number | string | null | undefined>
): Promise<{ fichas: Map<string, FichaMedicamentoOnze>; ok: boolean; error?: string }> {
  const fichas = new Map<string, FichaMedicamentoOnze>();
  const unicos = Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    )
  );
  if (unicos.length === 0) return { fichas, ok: true };

  const ahora = Date.now();
  const pendientes: number[] = [];
  for (const id of unicos) {
    const hit = cacheFichas().get(String(id));
    if (hit && hit.expiresAt > ahora) {
      if (hit.ficha) fichas.set(String(id), hit.ficha);
      continue;
    }
    pendientes.push(id);
  }
  if (pendientes.length === 0) return { fichas, ok: true };

  try {
    const pool = await getOnzePool();
    if (!pool) return { fichas, ok: false, error: 'MySQL Onze no configurado' };

    for (let i = 0; i < pendientes.length; i += CHUNK_IDS) {
      const lote = pendientes.slice(i, i + CHUNK_IDS);
      const consulta = pool.query(SQL_FICHAS, [lote]) as Promise<
        [Array<Record<string, unknown>>, unknown]
      >;
      const [rows] = await conTimeout(consulta, timeoutMs(), 'Onze fichas medicamento');
      const conDato = new Set<string>();
      for (const r of rows) {
        const codplex = String(Number(r.codplex));
        const unidades = numeroONull(r.unidades);
        const ficha: FichaMedicamentoOnze = {
          codplex,
          producto: textoONull(r.producto),
          presentaci: textoONull(r.presentaci),
          codebar: textoONull(r.codebar),
          troquel: numeroONull(r.troquel),
          codlab: numeroONull(r.codlab),
          idsubrubro: numeroONull(r.idsubrubro),
          idpsicofarmaco: textoONull(r.idpsicofarmaco),
          fraccionable: numeroONull(r.fraccionable),
          unidades: unidades != null && unidades > 0 ? unidades : UNIDADES_POR_CAJA_DEFAULT,
        };
        conDato.add(codplex);
        fichas.set(codplex, ficha);
        cacheFichas().set(codplex, { ficha, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      // Productos que Onze no conoce: se recuerdan para no volver a pedirlos.
      for (const id of lote) {
        if (!conDato.has(String(id))) {
          cacheFichas().set(String(id), { ficha: null, expiresAt: Date.now() + CACHE_TTL_MS });
        }
      }
    }
    return { fichas, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn('[onze medicamentos] fichas no disponibles:', error);
    return { fichas, ok: false, error };
  }
}

const SQL_CODEBARS = `
  SELECT IDProducto AS codplex, codebar
  FROM productoscodebars
  WHERE IDProducto IN (?)
  ORDER BY IDProducto, codebar
`;

/**
 * Códigos de barras secundarios desde `onze_center.productoscodebars`.
 * La copia de Supabase solo guardaba los primeros tres (`codebar2/3/4`); acá vienen todos.
 */
export async function getCodebarsSecundariosOnze(
  ids: Array<number | string | null | undefined>
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const unicos = Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    )
  );
  if (unicos.length === 0) return map;

  const ahora = Date.now();
  const pendientes: number[] = [];
  for (const id of unicos) {
    const hit = cacheCodebars().get(String(id));
    if (hit && hit.expiresAt > ahora) {
      if (hit.codebars.length > 0) map.set(String(id), hit.codebars);
      continue;
    }
    pendientes.push(id);
  }
  if (pendientes.length === 0) return map;

  try {
    const pool = await getOnzePool();
    if (!pool) return map;

    for (let i = 0; i < pendientes.length; i += CHUNK_IDS) {
      const lote = pendientes.slice(i, i + CHUNK_IDS);
      const consulta = pool.query(SQL_CODEBARS, [lote]) as Promise<
        [Array<{ codplex: number; codebar: string | null }>, unknown]
      >;
      const [rows] = await conTimeout(consulta, timeoutMs(), 'Onze codebars');
      for (const r of rows) {
        const id = String(Number(r.codplex));
        const cb = String(r.codebar ?? '').trim();
        if (!cb) continue;
        const lista = map.get(id) ?? [];
        if (!lista.includes(cb)) lista.push(cb);
        map.set(id, lista);
      }
      for (const id of lote) {
        cacheCodebars().set(String(id), {
          codebars: map.get(String(id)) ?? [],
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }
    }
  } catch (e) {
    console.warn(
      '[onze medicamentos] codebars secundarios no disponibles:',
      e instanceof Error ? e.message : e
    );
  }
  return map;
}

/**
 * Fichas de producto y códigos de barras secundarios, ambos desde `onze_center`
 * (`medicamentos` y `productoscodebars`).
 *
 * El parámetro `admin` se mantiene por compatibilidad con los llamadores; ya no se consulta
 * Supabase: la copia de `medicamentos` quedó fuera de uso.
 */
export async function getFichasMedicamento(
  _admin: SupabaseClient | null,
  ids: Array<number | string | null | undefined>
): Promise<{
  fichas: Map<string, FichaMedicamentoOnze>;
  codebarsSecundarios: Map<string, string[]>;
  desdeOnze: boolean;
}> {
  const [{ fichas, ok }, codebarsSecundarios] = await Promise.all([
    getFichasMedicamentoOnze(ids),
    getCodebarsSecundariosOnze(ids),
  ]);
  return { fichas, codebarsSecundarios, desdeOnze: ok };
}

/**
 * Producto al que pertenece un código de barras secundario (`onze_center.productoscodebars`).
 * Devuelve el menor `IDProducto` cuando el código está repetido, igual que hacía la copia.
 */
export async function getProductoIdPorCodebarOnze(codebar: string): Promise<number | null> {
  const code = String(codebar ?? '').trim();
  if (!code) return null;
  try {
    const pool = await getOnzePool();
    if (!pool) return null;
    const consulta = pool.query(
      'SELECT MIN(IDProducto) AS idproducto FROM productoscodebars WHERE codebar = ?',
      [code]
    ) as Promise<[Array<{ idproducto: number | null }>, unknown]>;
    const [rows] = await conTimeout(consulta, timeoutMs(), 'Onze codebar → producto');
    const id = Number(rows[0]?.idproducto ?? 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.warn(
      '[onze medicamentos] búsqueda por codebar:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
