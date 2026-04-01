import { Pool } from 'pg';

let pool: Pool | null = null;

function cleanHost(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/^host\s*[:=]\s*/i, '')
    .replace(/^host/i, '');
}

function getSslConfig() {
  const sslMode = (process.env.PADRON_DB_SSL ?? 'require').toLowerCase();
  if (sslMode === 'disable' || sslMode === 'false' || sslMode === 'off') return undefined;
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

async function getPadronColumnsMap(p: Pool): Promise<Map<string, string>> {
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

export async function getPadronPorProductos(productoIds: string[]) {
  const ids = Array.from(
    new Set(
      productoIds
        .map((x) => String(x ?? '').trim())
        .filter((x) => x.length > 0)
    )
  );
  if (ids.length === 0) {
    return new Map<string, { cat_macro: string | null; categoria: string | null; subrubro: string | null }>();
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
  if (!idCol || !categoriaCol) {
    throw new Error('padron_final no tiene columnas de idproducto/categoria esperadas');
  }

  const sql = `
    select
      ${quoteIdent(idCol)}::text as producto_id,
      ${catMacroCol ? `${quoteIdent(catMacroCol)}::text` : `null::text`} as cat_macro,
      ${quoteIdent(categoriaCol)}::text as categoria,
      ${subrubroCol ? `${quoteIdent(subrubroCol)}::text` : `null::text`} as subrubro
    from "padron_final"
    where ${quoteIdent(idCol)}::text = any($1::text[])
  `;

  const rows = await p.query<{
    producto_id: string | null;
    cat_macro: string | null;
    categoria: string | null;
    subrubro: string | null;
  }>(sql, [ids]);

  const map = new Map<string, { cat_macro: string | null; categoria: string | null; subrubro: string | null }>();
  for (const r of rows.rows) {
    const id = String(r.producto_id ?? '').trim();
    if (!id || map.has(id)) continue;
    map.set(id, {
      cat_macro: r.cat_macro ? String(r.cat_macro).trim() : null,
      categoria: r.categoria ? String(r.categoria).trim() : null,
      subrubro: r.subrubro ? String(r.subrubro).trim() : null,
    });
  }
  return map;
}

export async function getPadronOpcionesPerfumeria() {
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
