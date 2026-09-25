/**
 * Catálogos de onze_center que antes se leían de una copia en Supabase:
 * `laboratorios`, `categorias`, `subrubros` y `psicofarmacos`.
 *
 * Son tablas chicas (3.048, 61, 409 y 8 filas) y se consultan en auditorías y en el informe
 * de psicotrópicos, así que se cargan enteras y se cachean en memoria: una consulta cada diez
 * minutos por proceso en vez de una por request.
 *
 * Si Onze no responde, los lookups devuelven lo último cacheado, o un mapa vacío. Un nombre de
 * laboratorio o de categoría que falta no justifica tirar abajo una auditoría entera.
 */

import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import { conTimeout } from '@/lib/legacy-db/ventas-legacy-types';

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

function timeoutMs(): number {
  const n = parseInt(process.env.ONZE_CATALOGOS_QUERY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

type Catalogo = 'laboratorios' | 'categorias' | 'subrubros' | 'psicofarmacos';

interface EntradaCache {
  // Los cuatro catálogos guardan pares clave → valor; el tipo concreto lo pone cada getter.
  datos: Map<string, unknown>;
  expiresAt: number;
}

declare const globalThis: {
  __onzeCatalogosCache?: Map<Catalogo, EntradaCache>;
} & typeof global;

function cache(): Map<Catalogo, EntradaCache> {
  if (!globalThis.__onzeCatalogosCache) globalThis.__onzeCatalogosCache = new Map();
  return globalThis.__onzeCatalogosCache;
}

/**
 * Devuelve el catálogo cacheado; si venció, lo vuelve a leer. Ante error deja lo viejo
 * (aunque esté vencido) para no quedarse sin datos por un corte momentáneo.
 */
async function leerCatalogo<V>(
  nombre: Catalogo,
  sql: string,
  armar: (rows: Array<Record<string, unknown>>) => Map<string, V>
): Promise<Map<string, V>> {
  const entrada = cache().get(nombre);
  if (entrada && entrada.expiresAt > Date.now()) {
    return entrada.datos as Map<string, V>;
  }

  try {
    const pool = await getOnzePool();
    if (!pool) throw new Error('MySQL Onze no configurado');

    const consulta = pool.query(sql) as Promise<[Array<Record<string, unknown>>, unknown]>;
    const [rows] = await conTimeout(consulta, timeoutMs(), `Onze catálogo ${nombre}`);
    const datos = armar(rows);

    cache().set(nombre, {
      datos: datos as Map<string, unknown>,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return datos;
  } catch (e) {
    console.warn(`onze-catalogos (${nombre}):`, e instanceof Error ? e.message : String(e));
    return (entrada?.datos as Map<string, V>) ?? new Map<string, V>();
  }
}

function texto(valor: unknown): string {
  return String(valor ?? '').trim();
}

/** `CodLab` → nombre del laboratorio. */
export async function getNombresLaboratoriosOnze(): Promise<Map<number, string>> {
  const porId = await leerCatalogo<string>(
    'laboratorios',
    'SELECT CodLab, Laborato FROM laboratorios',
    (rows) => {
      const m = new Map<string, string>();
      for (const r of rows) {
        const id = Number(r.CodLab);
        if (Number.isFinite(id)) m.set(String(id), texto(r.Laborato));
      }
      return m;
    }
  );

  const out = new Map<number, string>();
  for (const [k, v] of porId) out.set(Number(k), v);
  return out;
}

/** Nombres de laboratorio para los códigos pedidos. */
export async function getNombresLaboratoriosPorCodlab(
  codlabs: Array<number | null | undefined>
): Promise<Map<number, string>> {
  const buscados = new Set(
    codlabs.map((c) => Number(c)).filter((c) => Number.isFinite(c) && c > 0)
  );
  const out = new Map<number, string>();
  if (buscados.size === 0) return out;

  const todos = await getNombresLaboratoriosOnze();
  for (const codlab of buscados) {
    const nombre = todos.get(codlab);
    if (nombre) out.set(codlab, nombre);
  }
  return out;
}

/** `IDCategoria` → nombre. */
export async function getNombresCategoriasOnze(): Promise<Map<number, string>> {
  const porId = await leerCatalogo<string>(
    'categorias',
    'SELECT IDCategoria, Nombre FROM categorias',
    (rows) => {
      const m = new Map<string, string>();
      for (const r of rows) {
        const id = Number(r.IDCategoria);
        if (Number.isFinite(id)) m.set(String(id), texto(r.Nombre));
      }
      return m;
    }
  );

  const out = new Map<number, string>();
  for (const [k, v] of porId) out.set(Number(k), v);
  return out;
}

/** `IDSubRubro` → `idCategoria` (null si el subrubro no tiene categoría). */
export async function getCategoriaPorSubrubroOnze(): Promise<Map<number, number | null>> {
  const porId = await leerCatalogo<number | null>(
    'subrubros',
    'SELECT IDSubRubro, idCategoria FROM subrubros',
    (rows) => {
      const m = new Map<string, number | null>();
      for (const r of rows) {
        const id = Number(r.IDSubRubro);
        if (!Number.isFinite(id)) continue;
        const cat = Number(r.idCategoria);
        m.set(String(id), Number.isFinite(cat) && cat > 0 ? cat : null);
      }
      return m;
    }
  );

  const out = new Map<number, number | null>();
  for (const [k, v] of porId) out.set(Number(k), v);
  return out;
}

/**
 * `IDPsicofarmaco` → nombre. Las claves quedan tal cual y también en mayúsculas, porque el
 * código referencia estos valores de las dos formas.
 */
export async function getNombresPsicofarmacosOnze(): Promise<Map<string, string>> {
  return leerCatalogo<string>(
    'psicofarmacos',
    'SELECT IDPsicofarmaco, Nombre FROM psicofarmacos',
    (rows) => {
      const m = new Map<string, string>();
      for (const r of rows) {
        const id = texto(r.IDPsicofarmaco);
        if (!id) continue;
        const nombre = texto(r.Nombre);
        m.set(id, nombre);
        m.set(id.toUpperCase(), nombre);
      }
      return m;
    }
  );
}
