import type { Pool } from 'pg';
import {
  getPadronPool,
  isPadronDatabaseConfigured,
} from '@/lib/padron-final-db';

export type PadronColumnMeta = {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinalPosition: number;
};

export type PadronMeta = {
  columns: PadronColumnMeta[];
  primaryKey: string;
  listDefaults: string[];
  /** Columna usada por defecto al listar (producto si existe). */
  defaultSortColumn: string;
};

export type PadronSortDir = 'asc' | 'desc';

const LIST_DEFAULT_CANDIDATES = [
  'idproducto',
  'codplex',
  'codebar',
  'codigo_barras',
  'codigo',
  'troquel',
  'producto',
  'descripcion',
  'presentacion',
  'presentaci',
  'cat_macro',
  'categoria',
  'categorianombre',
  'subrubronombre',
  'rubronombre',
  'nombrelab',
  'laboratorio',
  'activo',
];

const SEARCH_CANDIDATES = [
  'idproducto',
  'codplex',
  'codebar',
  'codigo_barras',
  'troquel',
  'producto',
  'descripcion',
  'presentacion',
  'presentaci',
  'categoria',
  'cat_macro',
  'subrubronombre',
  'rubronombre',
];

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

let metaCache: PadronMeta | null = null;

export function clearPadronMetaCache(): void {
  metaCache = null;
}

async function getColumnsDetailed(p: Pool): Promise<PadronColumnMeta[]> {
  const res = await p.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    ordinal_position: number;
  }>(
    `
      select column_name, data_type, is_nullable, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
        and lower(table_name) = 'padron_final'
      order by ordinal_position
    `
  );
  return res.rows.map((r) => ({
    name: String(r.column_name),
    dataType: String(r.data_type),
    isNullable: r.is_nullable === 'YES',
    ordinalPosition: Number(r.ordinal_position),
  }));
}

async function resolvePrimaryKey(p: Pool, columnNames: string[]): Promise<string> {
  const pkRes = await p.query<{ column_name: string }>(
    `
      select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = 'padron_final'
        and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.ordinal_position
      limit 1
    `
  );
  if (pkRes.rows[0]?.column_name) {
    return String(pkRes.rows[0].column_name);
  }

  const lowerSet = new Map(columnNames.map((c) => [c.toLowerCase(), c]));
  for (const cand of ['idproducto', 'codplex', 'id', 'pk']) {
    const real = lowerSet.get(cand);
    if (real) return real;
  }

  throw new Error(
    'No se pudo determinar la clave primaria de padron_final (definí PRIMARY KEY en la tabla)'
  );
}

function pickListDefaults(columns: PadronColumnMeta[]): string[] {
  const lowerToName = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]));
  const picked: string[] = [];
  for (const cand of LIST_DEFAULT_CANDIDATES) {
    const real = lowerToName.get(cand);
    if (real && !picked.includes(real)) picked.push(real);
    if (picked.length >= 10) break;
  }
  if (picked.length === 0 && columns.length > 0) {
    return columns.slice(0, Math.min(8, columns.length)).map((c) => c.name);
  }
  return picked;
}

export function resolveDefaultSortColumn(columns: PadronColumnMeta[]): string {
  const lowerToName = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]));
  for (const cand of ['producto', 'descripcion', 'nombre']) {
    const real = lowerToName.get(cand);
    if (real) return real;
  }
  return columns[0]?.name ?? 'idproducto';
}

export function resolveSortColumn(
  meta: PadronMeta,
  sortBy?: string | null
): string {
  const colSet = new Set(meta.columns.map((c) => c.name));
  const lowerToName = new Map(
    meta.columns.map((c) => [c.name.toLowerCase(), c.name])
  );
  const raw = String(sortBy ?? '').trim();
  if (raw && colSet.has(raw)) return raw;
  if (raw) {
    const byLower = lowerToName.get(raw.toLowerCase());
    if (byLower) return byLower;
  }
  return meta.defaultSortColumn;
}

export async function getPadronMeta(): Promise<PadronMeta> {
  if (!isPadronDatabaseConfigured()) {
    throw new Error('Base padron (abastecimiento) no configurada');
  }
  if (metaCache) return metaCache;

  const p = getPadronPool();
  const columns = await getColumnsDetailed(p);
  if (columns.length === 0) {
    throw new Error('La tabla padron_final no existe o no tiene columnas');
  }
  const primaryKey = await resolvePrimaryKey(
    p,
    columns.map((c) => c.name)
  );
  const listDefaults = pickListDefaults(columns);
  const defaultSortColumn = resolveDefaultSortColumn(columns);
  metaCache = { columns, primaryKey, listDefaults, defaultSortColumn };
  return metaCache;
}

function isTextType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return (
    t.includes('char') ||
    t.includes('text') ||
    t === 'uuid' ||
    t === 'json' ||
    t === 'jsonb'
  );
}

function pickSearchColumns(meta: PadronMeta): string[] {
  const lowerToName = new Map(meta.columns.map((c) => [c.name.toLowerCase(), c.name]));
  const picked: string[] = [];
  for (const cand of SEARCH_CANDIDATES) {
    const real = lowerToName.get(cand);
    if (!real) continue;
    const col = meta.columns.find((c) => c.name === real);
    if (col && isTextType(col.dataType)) picked.push(real);
  }
  if (picked.length === 0) {
    return meta.columns.filter((c) => isTextType(c.dataType)).slice(0, 12).map((c) => c.name);
  }
  return picked;
}

function normalizeCellValue(
  raw: unknown,
  col: PadronColumnMeta
): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return JSON.stringify(raw);

  const s = String(raw).trim();
  if (s === '' && col.isNullable) return null;

  const t = col.dataType.toLowerCase();
  if (t === 'boolean') {
    if (s === 'true' || s === '1' || s === 'S' || s === 's') return true;
    if (s === 'false' || s === '0' || s === 'N' || s === 'n') return false;
    return s.length > 0 ? Boolean(s) : null;
  }
  if (
    t.includes('int') ||
    t === 'numeric' ||
    t === 'double precision' ||
    t === 'real' ||
    t === 'decimal'
  ) {
    if (s === '') return col.isNullable ? null : 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

export type ListPadronOpts = {
  page?: number;
  pageSize?: number;
  q?: string;
  columns?: string[];
  sortBy?: string | null;
  sortDir?: PadronSortDir;
};

export async function listPadron(opts: ListPadronOpts = {}) {
  const meta = await getPadronMeta();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const { selectCols, selectList, whereSql, params, sortCol, sortDir, orderExpr } =
    buildPadronListQuery(meta, opts);

  const p = getPadronPool();
  const countSql = `select count(*)::int as total from "padron_final" ${whereSql}`;
  const dataSql = `
    select ${selectList}
    from "padron_final"
    ${whereSql}
    order by ${orderExpr} ${sortDir} nulls last, ${quoteIdent(meta.primaryKey)} asc
    limit $${params.length + 1} offset $${params.length + 2}
  `;

  const countRes = await p.query<{ total: number }>(countSql, params);
  const total = Number(countRes.rows[0]?.total ?? 0);

  const dataRes = await p.query(dataSql, [...params, pageSize, offset]);
  const rows = dataRes.rows.map((row) => mapPadronRow(row));

  return {
    data: rows,
    total,
    page,
    pageSize,
    columns: selectCols,
    meta,
    sortBy: sortCol,
    sortDir,
  };
}

const MAX_PADRON_EXPORT_ROWS = 100_000;

function buildPadronListQuery(meta: PadronMeta, opts: ListPadronOpts) {
  const colSet = new Set(meta.columns.map((c) => c.name));
  const defaultCols =
    opts.columns === undefined
      ? meta.listDefaults
      : opts.columns.length === 0
        ? meta.columns.map((c) => c.name)
        : opts.columns;
  let selectCols = defaultCols.filter((c) => colSet.has(c));
  if (!selectCols.includes(meta.primaryKey)) {
    selectCols = [meta.primaryKey, ...selectCols];
  }
  selectCols = Array.from(new Set(selectCols));

  const params: unknown[] = [];
  let whereSql = '';

  const term = String(opts.q ?? '').trim();
  if (term.length >= 2) {
    const searchCols = pickSearchColumns(meta);
    const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    params.push(like);
    const parts = searchCols.map(
      (c) => `${quoteIdent(c)}::text ilike $${params.length}`
    );
    if (parts.length > 0) {
      whereSql = `where (${parts.join(' or ')})`;
    }
  }

  const sortCol = resolveSortColumn(meta, opts.sortBy);
  const sortDir: PadronSortDir = opts.sortDir === 'desc' ? 'desc' : 'asc';
  const sortColMeta = meta.columns.find((c) => c.name === sortCol);
  const orderExpr =
    sortColMeta && isTextType(sortColMeta.dataType)
      ? `${quoteIdent(sortCol)}::text`
      : quoteIdent(sortCol);

  const selectList = selectCols.map((c) => quoteIdent(c)).join(', ');

  return { selectCols, selectList, whereSql, params, sortCol, sortDir, orderExpr };
}

function mapPadronRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      v instanceof Date
        ? v.toISOString()
        : typeof v === 'bigint'
          ? String(v)
          : v;
  }
  return out;
}

/** Listado sin paginación para exportación (con tope de filas). */
export async function listPadronForExport(
  opts: ListPadronOpts & { maxRows?: number } = {}
) {
  const meta = await getPadronMeta();
  const maxRows = Math.min(opts.maxRows ?? MAX_PADRON_EXPORT_ROWS, MAX_PADRON_EXPORT_ROWS);
  const { selectCols, selectList, whereSql, params, sortCol, sortDir, orderExpr } =
    buildPadronListQuery(meta, opts);

  const p = getPadronPool();
  const countSql = `select count(*)::int as total from "padron_final" ${whereSql}`;
  const countRes = await p.query<{ total: number }>(countSql, params);
  const total = Number(countRes.rows[0]?.total ?? 0);

  const dataSql = `
    select ${selectList}
    from "padron_final"
    ${whereSql}
    order by ${orderExpr} ${sortDir} nulls last, ${quoteIdent(meta.primaryKey)} asc
    limit $${params.length + 1}
  `;

  const dataRes = await p.query(dataSql, [...params, maxRows]);
  const rows = dataRes.rows.map((row) => mapPadronRow(row));

  return {
    data: rows,
    total,
    exported: rows.length,
    truncated: total > rows.length,
    columns: selectCols,
    meta,
    sortBy: sortCol,
    sortDir,
    maxRows,
  };
}

export async function getPadronRow(pkValue: string): Promise<Record<string, unknown>> {
  const meta = await getPadronMeta();
  const p = getPadronPool();
  const selectList = meta.columns.map((c) => quoteIdent(c.name)).join(', ');
  const sql = `
    select ${selectList}
    from "padron_final"
    where ${quoteIdent(meta.primaryKey)}::text = $1
    limit 1
  `;
  const res = await p.query(sql, [String(pkValue).trim()]);
  const row = res.rows[0];
  if (!row) {
    throw new Error('Registro no encontrado');
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? String(v) : v;
  }
  return out;
}

function buildRowFromPayload(
  meta: PadronMeta,
  payload: Record<string, unknown>,
  opts: { includePk: boolean }
): { cols: string[]; values: unknown[] } {
  const colByName = new Map(meta.columns.map((c) => [c.name, c]));
  const cols: string[] = [];
  const values: unknown[] = [];

  for (const [key, raw] of Object.entries(payload)) {
    const col = colByName.get(key);
    if (!col) continue;
    if (!opts.includePk && key === meta.primaryKey) continue;
    cols.push(col.name);
    values.push(normalizeCellValue(raw, col));
  }

  return { cols, values };
}

export async function createPadronRow(payload: Record<string, unknown>) {
  const meta = await getPadronMeta();
  const pkVal = payload[meta.primaryKey];
  if (pkVal == null || String(pkVal).trim() === '') {
    throw new Error(`El campo ${meta.primaryKey} es obligatorio`);
  }

  const { cols, values } = buildRowFromPayload(meta, payload, { includePk: true });
  if (cols.length === 0) {
    throw new Error('No hay campos válidos para insertar');
  }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `
    insert into "padron_final" (${cols.map(quoteIdent).join(', ')})
    values (${placeholders})
    returning ${quoteIdent(meta.primaryKey)}::text as pk
  `;

  const p = getPadronPool();
  try {
    const res = await p.query<{ pk: string }>(sql, values);
    return { pk: res.rows[0]?.pk ?? String(pkVal) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate') || msg.includes('unique')) {
      throw new Error('Ya existe un registro con esa clave primaria');
    }
    throw e;
  }
}

export async function updatePadronRow(
  pkValue: string,
  payload: Record<string, unknown>
) {
  const meta = await getPadronMeta();
  const { cols, values } = buildRowFromPayload(meta, payload, { includePk: false });
  if (cols.length === 0) {
    throw new Error('No hay campos para actualizar');
  }

  const setSql = cols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(', ');
  values.push(String(pkValue).trim());

  const sql = `
    update "padron_final"
    set ${setSql}
    where ${quoteIdent(meta.primaryKey)}::text = $${values.length}
    returning ${quoteIdent(meta.primaryKey)}::text as pk
  `;

  const p = getPadronPool();
  const res = await p.query<{ pk: string }>(sql, values);
  if (!res.rows[0]) {
    throw new Error('Registro no encontrado');
  }
  return { pk: res.rows[0].pk };
}

export async function deletePadronRow(pkValue: string) {
  const meta = await getPadronMeta();
  const p = getPadronPool();
  const sql = `
    delete from "padron_final"
    where ${quoteIdent(meta.primaryKey)}::text = $1
    returning ${quoteIdent(meta.primaryKey)}::text as pk
  `;
  const res = await p.query<{ pk: string }>(sql, [String(pkValue).trim()]);
  if (!res.rows[0]) {
    throw new Error('Registro no encontrado');
  }
  return { pk: res.rows[0].pk };
}
