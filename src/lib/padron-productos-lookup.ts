import {
  getPadronPool,
  getPadronPorProductos,
  isPadronDatabaseConfigured,
} from '@/lib/padron-final-db';
import { macroDesdePadron } from '@/lib/vencimientos-drogueria-lab';
import type { CategoriaMacro } from '@/lib/inventario/categoria-macro';
import { parseFraccionableValor } from '@/lib/inventario/fraccionable';
import type { ProductoLegacy } from '@/types';

export type PadronProductoFicha = {
  producto_id_sistema: string;
  codigo_barras: string | null;
  troquel: string | number | null;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  cat_macro: string | null;
  fraccionable?: number;
  refrigerado?: boolean;
  codigos_secundarios: string[];
  /** Ubicación física droguería (base_productos_drogueria). */
  sector?: number | null;
  modulo?: string | null;
  fila?: number | null;
  posicion?: number | null;
};

type ResolvedCols = {
  idCol: string;
  codebarCol: string | null;
  altCodebarCols: string[];
  troquelCol: string | null;
  productoCol: string | null;
  presentacionCol: string | null;
  laboratorioCol: string | null;
  catMacroCol: string | null;
  activoCol: string | null;
  fraccionableCol: string | null;
  refrigeracionCol: string | null;
};

let colsCache: ResolvedCols | null = null;

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/\\/g, ' ').replace(/%/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickCol(map: Map<string, string>, candidates: string[]): string | null {
  for (const c of candidates) {
    const real = map.get(c.toLowerCase());
    if (real) return real;
  }
  return null;
}

async function getResolvedCols(): Promise<ResolvedCols> {
  if (colsCache) return colsCache;

  const p = getPadronPool();
  const res = await p.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and lower(table_name) = 'padron_final'
    `
  );
  const map = new Map<string, string>();
  for (const r of res.rows) {
    map.set(String(r.column_name).toLowerCase(), String(r.column_name));
  }

  const allNames = [...map.values()];
  const altCodebarCols = allNames.filter((n) =>
    /^codebar\d+$/i.test(n) || /^codigo_barras_\d+$/i.test(n)
  );

  colsCache = {
    idCol: pickCol(map, ['idproducto', 'codplex', 'producto_id', 'id_producto'])!,
    codebarCol: pickCol(map, ['codebar', 'codigo_barras', 'codigo']),
    altCodebarCols: altCodebarCols.filter((n) => n.toLowerCase() !== 'codebar'),
    troquelCol: pickCol(map, ['troquel']),
    productoCol: pickCol(map, ['producto', 'descripcion', 'nombre']),
    presentacionCol: pickCol(map, ['presentacion', 'presentaci']),
    laboratorioCol: pickCol(map, ['nombrelab', 'laboratorio', 'laboratorionombre', 'lab_nombre']),
    catMacroCol: pickCol(map, ['cat_macro', 'catmacro', 'categoria_macro']),
    activoCol: pickCol(map, ['activo', 'habilitado', 'vigente']),
    fraccionableCol: pickCol(map, ['fraccionable']),
    refrigeracionCol: pickCol(map, ['refrigeracion', 'refrigerado']),
  };

  if (!colsCache.idCol) {
    throw new Error('padron_final: no se encontró columna de ID (idproducto/codplex)');
  }

  return colsCache;
}

function mapRawRow(row: Record<string, unknown>, cols: ResolvedCols): PadronProductoFicha {
  const id = String(row[cols.idCol] ?? '').trim();
  const codebar = cols.codebarCol ? String(row[cols.codebarCol] ?? '').trim() : '';
  const altCodes = cols.altCodebarCols
    .map((c) => String(row[c] ?? '').trim())
    .filter((c) => c.length > 0 && c !== codebar);

  const troquelRaw = cols.troquelCol ? row[cols.troquelCol] : null;
  let troquel: string | number | null = null;
  if (troquelRaw != null) {
    const troquelStr = String(troquelRaw).trim();
    if (troquelStr !== '') {
      const n = Number(troquelStr);
      troquel = Number.isFinite(n) ? n : troquelStr;
    }
  }

  let fraccionable: number | undefined;
  if (cols.fraccionableCol && row[cols.fraccionableCol] != null) {
    fraccionable = parseFraccionableValor(row[cols.fraccionableCol]);
  }

  const refrigerado = cols.refrigeracionCol
    ? String(row[cols.refrigeracionCol] ?? '').toUpperCase() === 'S'
    : undefined;

  return {
    producto_id_sistema: id,
    codigo_barras: codebar || null,
    troquel,
    descripcion: cols.productoCol ? String(row[cols.productoCol] ?? '').trim() : '',
    presentacion: cols.presentacionCol
      ? String(row[cols.presentacionCol] ?? '').trim() || null
      : null,
    laboratorio: cols.laboratorioCol
      ? String(row[cols.laboratorioCol] ?? '').trim() || null
      : null,
    cat_macro: cols.catMacroCol
      ? String(row[cols.catMacroCol] ?? '').trim() || null
      : null,
    fraccionable,
    refrigerado,
    codigos_secundarios: altCodes,
  };
}

function selectList(cols: ResolvedCols): string {
  const parts = [quoteIdent(cols.idCol)];
  if (cols.codebarCol) parts.push(quoteIdent(cols.codebarCol));
  for (const c of cols.altCodebarCols) parts.push(quoteIdent(c));
  if (cols.troquelCol) parts.push(quoteIdent(cols.troquelCol));
  if (cols.productoCol) parts.push(quoteIdent(cols.productoCol));
  if (cols.presentacionCol) parts.push(quoteIdent(cols.presentacionCol));
  if (cols.laboratorioCol) parts.push(quoteIdent(cols.laboratorioCol));
  if (cols.catMacroCol) parts.push(quoteIdent(cols.catMacroCol));
  if (cols.activoCol) parts.push(quoteIdent(cols.activoCol));
  if (cols.fraccionableCol) parts.push(quoteIdent(cols.fraccionableCol));
  if (cols.refrigeracionCol) parts.push(quoteIdent(cols.refrigeracionCol));
  return Array.from(new Set(parts)).join(', ');
}

async function queryRows(sql: string, params: unknown[]): Promise<PadronProductoFicha[]> {
  const cols = await getResolvedCols();
  const p = getPadronPool();
  const res = await p.query<Record<string, unknown>>(sql, params);
  return res.rows.map((row) => mapRawRow(row, cols));
}

export function padronProductosDisponible(): boolean {
  return isPadronDatabaseConfigured();
}

async function enrichFraccionableDesdeMedicamentos(
  fichas: PadronProductoFicha[]
): Promise<PadronProductoFicha[]> {
  const sinDato = fichas.filter((f) => f.fraccionable == null);
  if (sinDato.length === 0) return fichas;

  const ids = Array.from(
    new Set(
      sinDato
        .map((f) => Number(f.producto_id_sistema))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  if (ids.length === 0) return fichas;

  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const admin = await createAdminClient();
    const fraccionablePorId = new Map<number, number>();

    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const lote = ids.slice(i, i + chunkSize);
      const { data, error } = await admin
        .from('medicamentos')
        .select('codplex, fraccionable')
        .in('codplex', lote);
      if (error) {
        console.warn('[padron] fraccionable desde medicamentos:', error.message);
        break;
      }
      for (const row of data ?? []) {
        const id = Number((row as { codplex?: number }).codplex);
        const fr = parseFraccionableValor((row as { fraccionable?: unknown }).fraccionable);
        if (Number.isFinite(id) && fr != null) {
          fraccionablePorId.set(id, fr);
        }
      }
    }

    if (fraccionablePorId.size === 0) return fichas;

    return fichas.map((f) => {
      if (f.fraccionable != null) return f;
      const id = Number(f.producto_id_sistema);
      const fr = fraccionablePorId.get(id);
      return fr != null ? { ...f, fraccionable: fr } : f;
    });
  } catch (e) {
    console.warn('[padron] enrichFraccionableDesdeMedicamentos:', (e as Error).message);
    return fichas;
  }
}

async function enrichFraccionableFicha(
  ficha: PadronProductoFicha | null
): Promise<PadronProductoFicha | null> {
  if (!ficha) return null;
  const [enriched] = await enrichFraccionableDesdeMedicamentos([ficha]);
  return enriched ?? ficha;
}

export async function getProductoPadronById(
  id: string | number
): Promise<PadronProductoFicha | null> {
  if (!padronProductosDisponible()) return null;
  const cols = await getResolvedCols();
  const idStr = String(id).trim();
  if (!idStr) return null;

  const sql = `
    select ${selectList(cols)}
    from "padron_final"
    where ${quoteIdent(cols.idCol)}::text = $1
    limit 1
  `;
  const rows = await queryRows(sql, [idStr]);
  return enrichFraccionableFicha(rows[0] ?? null);
}

export async function getProductosPadronByIds(
  ids: Array<string | number>
): Promise<PadronProductoFicha[]> {
  if (!padronProductosDisponible()) return [];
  const unique = Array.from(
    new Set(ids.map((x) => String(x).trim()).filter((x) => x.length > 0))
  );
  if (unique.length === 0) return [];

  const cols = await getResolvedCols();
  const sql = `
    select ${selectList(cols)}
    from "padron_final"
    where ${quoteIdent(cols.idCol)}::text = any($1::text[])
  `;
  const rows = await queryRows(sql, [unique]);
  return enrichFraccionableDesdeMedicamentos(rows);
}

export async function getProductoPadronByBarcode(
  barcode: string
): Promise<PadronProductoFicha | null> {
  if (!padronProductosDisponible()) return null;
  const code = String(barcode).trim();
  if (!code) return null;

  const cols = await getResolvedCols();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (cols.codebarCol) {
    params.push(code);
    conditions.push(`${quoteIdent(cols.codebarCol)}::text = $${params.length}`);
  }
  for (const alt of cols.altCodebarCols) {
    params.push(code);
    conditions.push(`${quoteIdent(alt)}::text = $${params.length}`);
  }
  if (cols.troquelCol && /^\d+$/.test(code)) {
    params.push(code);
    conditions.push(`${quoteIdent(cols.troquelCol)}::text = $${params.length}`);
  }

  if (cols.idCol && /^\d+$/.test(code)) {
    params.push(code);
    conditions.push(`${quoteIdent(cols.idCol)}::text = $${params.length}`);
  }

  if (conditions.length === 0) return null;

  const sql = `
    select ${selectList(cols)}
    from "padron_final"
    where (${conditions.join(' or ')})
    limit 1
  `;
  const rows = await queryRows(sql, params);
  return enrichFraccionableFicha(rows[0] ?? null);
}

function escapeIlikePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

function columnasBusquedaPadron(cols: ResolvedCols): string[] {
  const out: string[] = [];
  if (cols.idCol) out.push(cols.idCol);
  if (cols.codebarCol) out.push(cols.codebarCol);
  for (const c of cols.altCodebarCols) out.push(c);
  if (cols.troquelCol) out.push(cols.troquelCol);
  if (cols.productoCol) out.push(cols.productoCol);
  if (cols.presentacionCol) out.push(cols.presentacionCol);
  if (cols.laboratorioCol) out.push(cols.laboratorioCol);
  return Array.from(new Set(out));
}

/**
 * Búsqueda en padron_final para inventarios ocasionales / auditoría.
 * Misma amplitud que el listado admin: varias columnas, sin filtrar por activo.
 */
export async function buscarProductosEnPadron(
  rawQ: string,
  limit = 40
): Promise<PadronProductoFicha[]> {
  if (!padronProductosDisponible()) return [];

  const q = sanitizeIlikeTerm(rawQ);
  if (!q || q.length < 2) return [];

  const cols = await getResolvedCols();
  const select = selectList(cols);
  const p = getPadronPool();
  const seen = new Map<string, PadronProductoFicha>();

  function merge(rows: PadronProductoFicha[]) {
    for (const r of rows) {
      if (!r.producto_id_sistema || seen.has(r.producto_id_sistema)) continue;
      seen.set(r.producto_id_sistema, r);
      if (seen.size >= limit) break;
    }
  }

  const exactConds: string[] = [];
  const exactParams: unknown[] = [];
  if (cols.idCol) {
    exactParams.push(q);
    exactConds.push(`${quoteIdent(cols.idCol)}::text = $${exactParams.length}`);
  }
  if (cols.troquelCol) {
    exactParams.push(q);
    exactConds.push(`${quoteIdent(cols.troquelCol)}::text = $${exactParams.length}`);
  }
  if (cols.codebarCol) {
    exactParams.push(q);
    exactConds.push(`${quoteIdent(cols.codebarCol)}::text = $${exactParams.length}`);
  }
  for (const alt of cols.altCodebarCols) {
    exactParams.push(q);
    exactConds.push(`${quoteIdent(alt)}::text = $${exactParams.length}`);
  }

  if (exactConds.length > 0) {
    const sqlExact = `
      select ${select}
      from "padron_final"
      where (${exactConds.join(' or ')})
      limit 25
    `;
    const exactRes = await p.query<Record<string, unknown>>(sqlExact, exactParams);
    merge(exactRes.rows.map((row) => mapRawRow(row, cols)));
  }

  if (seen.size < limit) {
    const searchCols = columnasBusquedaPadron(cols);
    if (searchCols.length > 0) {
      const like = escapeIlikePattern(q);
      const parts = searchCols.map((c) => `${quoteIdent(c)}::text ilike $1`);
      const orderCol = cols.productoCol
        ? quoteIdent(cols.productoCol)
        : quoteIdent(cols.idCol);
      const sqlLike = `
        select ${select}
        from "padron_final"
        where (${parts.join(' or ')})
        order by ${orderCol} asc nulls last
        limit $2
      `;
      const likeRes = await p.query<Record<string, unknown>>(sqlLike, [like, limit * 2]);
      merge(likeRes.rows.map((row) => mapRawRow(row, cols)));
    }
  }

  return Array.from(seen.values()).slice(0, limit);
}

/** IDs que existen en padron_final y coinciden con la categoría macro pedida. */
export async function filtrarIdsPorCategoriaMacroPadron(
  ids: number[],
  categoriaMacro: CategoriaMacro
): Promise<number[]> {
  if (ids.length === 0) return [];
  const padron = await getPadronPorProductos(ids.map(String));
  return ids.filter((id) => {
    const p = padron.get(String(id));
    if (!p?.cat_macro) return false;
    return macroDesdePadron(p.cat_macro) === categoriaMacro;
  });
}

export async function idsExistenEnPadron(ids: number[]): Promise<Set<number>> {
  if (!padronProductosDisponible() || ids.length === 0) return new Set();
  const fichas = await getProductosPadronByIds(ids);
  return new Set(
    fichas
      .map((f) => Number(f.producto_id_sistema))
      .filter((n) => Number.isFinite(n))
  );
}

export function fichaPadronABusqueda(ficha: PadronProductoFicha) {
  return {
    producto_id_sistema: ficha.producto_id_sistema,
    codigo_barras: ficha.codigo_barras,
    troquel: ficha.troquel,
    descripcion: ficha.descripcion,
    presentacion: ficha.presentacion,
    laboratorio: ficha.laboratorio,
    cat_macro: ficha.cat_macro,
  };
}

export function fichaPadronAProductoLegacy(
  ficha: PadronProductoFicha,
  stock?: {
    stock_sistema: number;
    stock_cajas?: number;
    stock_unidades?: number;
    unidades_por_caja?: number;
  }
): ProductoLegacy {
  return {
    producto_id_sistema: ficha.producto_id_sistema,
    codigo_barras: ficha.codigo_barras,
    troquel: ficha.troquel,
    codigos_secundarios: ficha.codigos_secundarios,
    descripcion: ficha.descripcion,
    presentacion: ficha.presentacion,
    laboratorio: ficha.laboratorio,
    stock_sistema: stock?.stock_sistema ?? 0,
    stock_cajas: stock?.stock_cajas,
    stock_unidades: stock?.stock_unidades,
    unidades_por_caja: stock?.unidades_por_caja,
    fraccionable: ficha.fraccionable,
    refrigerado: ficha.refrigerado,
    sector: ficha.sector ?? null,
    modulo: ficha.modulo ?? null,
    fila: ficha.fila ?? null,
    posicion: ficha.posicion ?? null,
  };
}

export async function resolverStockLegacy(
  sucursalId: string | undefined,
  productoId: string,
  allowMissingStock: boolean
): Promise<
  | { ok: true; stock: NonNullable<Parameters<typeof fichaPadronAProductoLegacy>[1]> }
  | { ok: false; failed: boolean }
> {
  if (!sucursalId) {
    return { ok: false, failed: true };
  }

  const sucursalNum = parseInt(sucursalId, 10);
  const idProducto = Number(productoId);
  if (Number.isNaN(sucursalNum) || Number.isNaN(idProducto)) {
    return { ok: false, failed: true };
  }

  const MAX_ATTEMPTS = 3;
  // Antes 3s: MySQL Onze a menudo supera eso y devolvía 503 en ~1–3s por carrera/reintentos.
  const TIMEOUT_MS = (() => {
    const n = parseInt(process.env.ONZE_STOCK_QUERY_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 12_000;
  })();

  try {
    const { getStockFromLegacyDetailed, legacyStockRaceToSistemaFields } = await import(
      '@/lib/legacy-db/mysql-stock'
    );

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const stockResult = await Promise.race([
        getStockFromLegacyDetailed(sucursalNum, idProducto),
        new Promise<{ status: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ status: 'timeout' }), TIMEOUT_MS)
        ),
      ]);

      const resolved = legacyStockRaceToSistemaFields(stockResult, allowMissingStock);
      if (resolved.ok) {
        return {
          ok: true,
          stock: {
            stock_sistema: resolved.stock_sistema,
            stock_cajas: resolved.stock_cajas,
            stock_unidades: resolved.stock_unidades,
            unidades_por_caja: resolved.unidades_por_caja,
          },
        };
      }

      const transitorio =
        stockResult.status === 'timeout' || stockResult.status === 'unavailable';
      if (transitorio && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }

      if (stockResult.status === 'timeout') {
        console.warn(
          `[stock-live] timeout MySQL tras ${TIMEOUT_MS}ms (intento ${attempt + 1}/${MAX_ATTEMPTS}) producto=${productoId}`
        );
      } else if (stockResult.status === 'unavailable') {
        console.warn(
          `[stock-live] MySQL unavailable (intento ${attempt + 1}/${MAX_ATTEMPTS}) producto=${productoId}`,
          'error' in stockResult ? stockResult.error : undefined
        );
      }

      return { ok: false, failed: true };
    }

    return { ok: false, failed: true };
  } catch (e) {
    console.error('Error obteniendo stock legacy para producto', productoId, e);
    return { ok: false, failed: true };
  }
}

function mapMedicamentoAFicha(row: Record<string, unknown>): PadronProductoFicha | null {
  const codplex = row.codplex ?? row.CodPlex;
  const id = Number(codplex);
  if (!Number.isFinite(id) || id <= 0) return null;

  const codebars = [
    row.codebar,
    row.codebar2,
    row.codebar3,
    row.codebar4,
  ]
    .map((c) => (c == null ? '' : String(c).trim()))
    .filter((c) => c.length > 0);

  const descripcion = String(row.producto ?? row.Producto ?? '').trim() || `Producto ${id}`;
  const presentacion = row.presentaci ?? row.Presentaci;
  const fraccionable = parseFraccionableValor(row.fraccionable ?? row.Fraccionable);

  const troquelRaw = row.troquel ?? row.Troquel;
  const troquel =
    troquelRaw == null || troquelRaw === ''
      ? null
      : typeof troquelRaw === 'string' || typeof troquelRaw === 'number'
        ? troquelRaw
        : String(troquelRaw);

  return {
    producto_id_sistema: String(id),
    codigo_barras: codebars[0] ?? null,
    troquel,
    descripcion,
    presentacion: presentacion == null ? null : String(presentacion),
    laboratorio: null,
    cat_macro: null,
    fraccionable: fraccionable ?? undefined,
    codigos_secundarios: codebars.slice(1),
  };
}

async function getFichasDesdeMedicamentos(
  admin: Awaited<ReturnType<typeof import('@/lib/supabase/server').createAdminClient>>,
  ids: number[]
): Promise<PadronProductoFicha[]> {
  const unicos = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (unicos.length === 0) return [];

  const fichas: PadronProductoFicha[] = [];
  const chunkSize = 500;
  for (let i = 0; i < unicos.length; i += chunkSize) {
    const lote = unicos.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, troquel, codebar, codebar2, codebar3, codebar4, producto, presentaci, fraccionable')
      .in('codplex', lote);
    if (error) {
      console.warn('[inventario] fichas desde medicamentos:', error.message);
      break;
    }
    for (const row of data ?? []) {
      const ficha = mapMedicamentoAFicha(row as Record<string, unknown>);
      if (ficha) fichas.push(ficha);
    }
  }
  return fichas;
}

/**
 * Fichas para precargar inventario diario.
 * Los IDs siempre vienen de base_productos / base_productos_drogueria.
 * - Droguería: datos desde base_productos_drogueria (+ Quantio si aplica).
 * - Resto: enriquecer desde padrón; si falta ficha, stub mínimo para no perder el cupo.
 * - Sin padrón: completa faltantes desde la tabla catálogo `medicamentos`.
 */
export async function getFichasInventarioDiario(
  admin: Awaited<ReturnType<typeof import('@/lib/supabase/server').createAdminClient>>,
  ids: number[],
  opts: { sinPadron: boolean; drogueria?: boolean; trimestre?: string | null }
): Promise<PadronProductoFicha[]> {
  const ordenados = ids.filter((n) => Number.isFinite(n) && n > 0);
  if (ordenados.length === 0) return [];

  const porId = new Map<number, PadronProductoFicha>();

  if (opts.drogueria) {
    const { getFichasDesdeBaseProductosDrogueria } = await import(
      '@/lib/inventario/base-productos-drogueria'
    );
    return getFichasDesdeBaseProductosDrogueria(admin, ordenados, opts.trimestre ?? null);
  }

  if (padronProductosDisponible()) {
    const fromPadron = await getProductosPadronByIds(ordenados);
    for (const f of fromPadron) {
      const id = Number(f.producto_id_sistema);
      if (Number.isFinite(id)) porId.set(id, f);
    }
  }

  if (opts.sinPadron) {
    const faltantes = ordenados.filter((id) => !porId.has(id));
    if (faltantes.length > 0) {
      for (const f of await getFichasDesdeMedicamentos(admin, faltantes)) {
        const id = Number(f.producto_id_sistema);
        if (Number.isFinite(id) && !porId.has(id)) porId.set(id, f);
      }
    }
  }

  // No descartar IDs que vinieron de base_productos: stub si no hay ficha enriquecida.
  return ordenados.map((id) => {
    const f = porId.get(id);
    if (f) return f;
    return {
      producto_id_sistema: String(id),
      codigo_barras: null,
      troquel: null,
      descripcion: `Producto ${id}`,
      presentacion: null,
      laboratorio: null,
      cat_macro: null,
      codigos_secundarios: [],
    };
  });
}
