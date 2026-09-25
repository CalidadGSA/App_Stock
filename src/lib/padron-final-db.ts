import { readFileSync } from 'fs';
import { Pool } from 'pg';

let pool: Pool | null = null;

function cleanHost(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/^host\s*[:=]\s*/i, '')
    .replace(/^host/i, '');
}

/** True si hay PADRON_DB_URL o las cuatro variables discretas (host, name, user, password). */
export function isPadronDatabaseConfigured(): boolean {
  if (String(process.env.PADRON_DB_URL ?? '').trim()) return true;
  const host = cleanHost(process.env.PADRON_DB_HOST);
  const database = String(process.env.PADRON_DB_NAME ?? '').trim();
  const user = String(process.env.PADRON_DB_USER ?? '').trim();
  const password = String(process.env.PADRON_DB_PASSWORD ?? '').trim();
  return !!(host && database && user && password);
}

let sslWarned = false;

/**
 * TLS hacia el Postgres del padrón.
 *  - PADRON_DB_SSL=disable → sin TLS.
 *  - PADRON_DB_SSL_CA (PEM inline o ruta a .crt, p. ej. el CA de DigitalOcean) → verifica el certificado.
 *  - PADRON_DB_SSL_REJECT_UNAUTHORIZED=1 → verifica contra las CAs del sistema.
 *  - Sin nada de eso: cifra pero no verifica (compatibilidad con el deploy actual); se avisa por log.
 */
function getSslConfig(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  const sslMode = (process.env.PADRON_DB_SSL ?? 'require').toLowerCase();
  if (sslMode === 'disable' || sslMode === 'false' || sslMode === 'off') return undefined;

  const caRaw = String(process.env.PADRON_DB_SSL_CA ?? '').trim();
  if (caRaw) {
    try {
      const ca = caRaw.includes('-----BEGIN')
        ? caRaw.replace(/\\n/g, '\n')
        : readFileSync(caRaw, 'utf8');
      return { rejectUnauthorized: true, ca };
    } catch (e) {
      // Un CA mal escrito o ausente (p. ej. la ruta del server en una máquina de desarrollo)
      // no debe dejar sin padrón a toda la app: se avisa fuerte y se sigue cifrando sin verificar.
      console.error(
        `[padron] No se pudo leer PADRON_DB_SSL_CA (${caRaw}): ${
          e instanceof Error ? e.message : String(e)
        }. Se conecta cifrado pero SIN verificar el certificado.`
      );
    }
  }
  if (process.env.PADRON_DB_SSL_REJECT_UNAUTHORIZED === '1') {
    return { rejectUnauthorized: true };
  }
  if (!sslWarned) {
    sslWarned = true;
    console.warn(
      '[padron] TLS sin verificar certificado (rejectUnauthorized=false). Configurá PADRON_DB_SSL_CA para verificarlo.'
    );
  }
  return { rejectUnauthorized: false };
}

export function getPadronPool(): Pool {
  if (pool) return pool;

  if (process.env.PADRON_DB_URL) {
    pool = new Pool({
      connectionString: process.env.PADRON_DB_URL,
      ssl: getSslConfig(),
      max: 5,
    });
    return pool;
  }

  const host = cleanHost(process.env.PADRON_DB_HOST);
  const database = process.env.PADRON_DB_NAME;
  const user = process.env.PADRON_DB_USER;
  const password = process.env.PADRON_DB_PASSWORD;
  const port = process.env.PADRON_DB_PORT ? Number(process.env.PADRON_DB_PORT) : 25060;

  if (!host || !database || !user || !password) {
    throw new Error(
      'Faltan variables PADRON_DB_HOST, PADRON_DB_NAME, PADRON_DB_USER o PADRON_DB_PASSWORD'
    );
  }

  pool = new Pool({
    host,
    database,
    user,
    password,
    port,
    ssl: getSslConfig(),
    max: 5,
  });

  return pool;
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** El esquema de padron_final no cambia en caliente: no hace falta ir a information_schema en cada llamada. */
const COLUMNS_CACHE_TTL_MS = 10 * 60 * 1000;
let columnsCache: { map: Map<string, string>; expiresAt: number } | null = null;

async function getPadronColumnsMap(p: Pool): Promise<Map<string, string>> {
  if (columnsCache && columnsCache.expiresAt > Date.now()) return columnsCache.map;
  const cols = await p.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and lower(table_name) = 'padron_final'
    `
  );
  const map = new Map<string, string>();
  for (const c of cols.rows) {
    map.set(String(c.column_name).toLowerCase(), String(c.column_name));
  }
  if (map.size > 0) columnsCache = { map, expiresAt: Date.now() + COLUMNS_CACHE_TTL_MS };
  return map;
}

async function queryPadronPerfumeriaRows() {
  const p = getPadronPool();
  const cols = await getPadronColumnsMap(p);

  const pickCol = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const real = cols.get(c.toLowerCase());
      if (real) return real;
    }
    return null;
  };

  const codebarCol = pickCol(['codebar', 'codigo_barras', 'codigo']);
  const codplexCol = pickCol(['codplex', 'idproducto', 'producto_id', 'id_producto']);
  const subrubroCol = pickCol(['subrubronombre', 'subrubro', 'sub_rubro']);
  const categoriaCol = pickCol(['categoria', 'categorianombre', 'categoria_nombre']);
  const rubroCol = pickCol(['rubronombre', 'rubro_nombre', 'rubro']);

  if (!subrubroCol || !categoriaCol || !rubroCol || (!codebarCol && !codplexCol)) {
    throw new Error(
      'padron_final no tiene columnas esperadas (rubro/subrubro/categoria y codebar o codplex)'
    );
  }

  const selectCols = [
    codebarCol ? `${quoteIdent(codebarCol)}::text as codebar` : `null::text as codebar`,
    codplexCol ? `${quoteIdent(codplexCol)}::text as codplex` : `null::text as codplex`,
    `${quoteIdent(subrubroCol)}::text as subrubro`,
    `${quoteIdent(categoriaCol)}::text as categoria`,
  ].join(', ');

  const sql = `
    select ${selectCols}
    from "padron_final"
    where upper(
      translate(trim(coalesce(${quoteIdent(rubroCol)}::text, '')), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')
    ) = $1
  `;

  const rows = await p.query<{
    codebar: string | null;
    codplex: string | null;
    subrubro: string | null;
    categoria: string | null;
  }>(sql, ['PERFUMERIA']);

  return rows.rows;
}

export type PadronProductoCampos = {
  cat_macro: string | null;
  categoria: string | null;
  subrubro: string | null;
  /** Clasificación operativa Marrone (ej. PSICOTROPICOS, MEDICAMENTOS, PERFUMERIA). */
  proveedormarrone: string | null;
};

export async function getPadronPorProductos(productoIds: string[]) {
  const empty = new Map<string, PadronProductoCampos>();
  if (!isPadronDatabaseConfigured()) return empty;

  const ids = Array.from(
    new Set(
      productoIds
        .map((x) => String(x ?? '').trim())
        .filter((x) => x.length > 0)
    )
  );
  if (ids.length === 0) {
    return empty;
  }

  const p = getPadronPool();
  const cols = await getPadronColumnsMap(p);
  const pickCol = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const real = cols.get(c.toLowerCase());
      if (real) return real;
    }
    return null;
  };

  const idCol = pickCol(['idproducto', 'codplex', 'producto_id', 'id_producto']);
  const categoriaCol = pickCol(['categoria', 'categorianombre', 'categoria_nombre']);
  const catMacroCol = pickCol(['cat_macro', 'catmacro', 'categoria_macro']);
  const subrubroCol = pickCol(['subrubronombre', 'subrubro', 'sub_rubro']);
  const proveedorMarroneCol = pickCol([
    'proveedormarrone',
    'proveedor_marrone',
    'proveedorMarrone',
  ]);
  if (!idCol || !categoriaCol) {
    throw new Error('padron_final no tiene columnas de idproducto/categoria esperadas');
  }

  const sql = `
    select
      ${quoteIdent(idCol)}::text as producto_id,
      ${catMacroCol ? `${quoteIdent(catMacroCol)}::text` : `null::text`} as cat_macro,
      ${quoteIdent(categoriaCol)}::text as categoria,
      ${subrubroCol ? `${quoteIdent(subrubroCol)}::text` : `null::text`} as subrubro,
      ${
        proveedorMarroneCol
          ? `${quoteIdent(proveedorMarroneCol)}::text`
          : `null::text`
      } as proveedormarrone
    from "padron_final"
    where ${quoteIdent(idCol)}::text = any($1::text[])
  `;

  const rows = await p.query<{
    producto_id: string | null;
    cat_macro: string | null;
    categoria: string | null;
    subrubro: string | null;
    proveedormarrone: string | null;
  }>(sql, [ids]);

  const map = new Map<string, PadronProductoCampos>();
  for (const r of rows.rows) {
    const id = String(r.producto_id ?? '').trim();
    if (!id || map.has(id)) continue;
    map.set(id, {
      cat_macro: r.cat_macro ? String(r.cat_macro).trim() : null,
      categoria: r.categoria ? String(r.categoria).trim() : null,
      subrubro: r.subrubro ? String(r.subrubro).trim() : null,
      proveedormarrone: r.proveedormarrone ? String(r.proveedormarrone).trim() : null,
    });
  }
  return map;
}

export async function getPadronOpcionesPerfumeria() {
  if (!isPadronDatabaseConfigured()) return [];

  const rows = await queryPadronPerfumeriaRows();
  const uniq = new Set<string>();
  const out: Array<{ subrubro: string; categoria: string }> = [];
  for (const r of rows) {
    const subrubro = String(r.subrubro ?? '').trim();
    const categoria = String(r.categoria ?? '').trim();
    if (!subrubro || !categoria) continue;
    const key = `${subrubro}|${categoria}`;
    if (uniq.has(key)) continue;
    uniq.add(key);
    out.push({ subrubro, categoria });
  }
  out.sort((a, b) => (a.subrubro + a.categoria).localeCompare(b.subrubro + b.categoria));
  return out;
}

export async function getPadronPerfumeriaMap() {
  if (!isPadronDatabaseConfigured()) {
    return { byCodebar: new Map<string, { subrubro: string; categoria: string }>(), byCodplex: new Map() };
  }

  const rows = await queryPadronPerfumeriaRows();

  const byCodebar = new Map<string, { subrubro: string; categoria: string }>();
  const byCodplex = new Map<string, { subrubro: string; categoria: string }>();

  for (const r of rows) {
    const subrubro = String(r.subrubro ?? '').trim();
    const categoria = String(r.categoria ?? '').trim();
    if (!subrubro || !categoria) continue;

    const codebar = String(r.codebar ?? '').trim();
    const codplex = String(r.codplex ?? '').trim();

    if (codebar && !byCodebar.has(codebar)) byCodebar.set(codebar, { subrubro, categoria });
    if (codplex && !byCodplex.has(codplex)) byCodplex.set(codplex, { subrubro, categoria });
  }

  return { byCodebar, byCodplex };
}
