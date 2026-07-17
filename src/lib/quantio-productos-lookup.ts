import type { PadronProductoFicha } from '@/lib/padron-productos-lookup';
import { getQuantioPool, isQuantioDatabaseConfigured } from '@/lib/legacy-db/quantio-mysql';
import type { ProductoLegacy } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductoQuantioRow = {
  idproducto: number;
  producto: string | null;
  presentacion: string | null;
  prod_pres: string | null;
  codebar: string | null;
  troquel: number | null;
  unidades: number | null;
  activo: string | null;
  refrigeracion: string | null;
  idlaboratorio: number | null;
  idrubro: number | null;
  idsubrubro: number | null;
  idpsicofarmaco: string | null;
  gtin: string | null;
  costo: number | null;
  ultimoprecio: number | null;
};

function mapSupabaseRow(row: Record<string, unknown>): ProductoQuantioRow {
  return {
    idproducto: Number(row.idproducto),
    producto: row.producto == null ? null : String(row.producto),
    presentacion: row.presentacion == null ? null : String(row.presentacion),
    prod_pres: row.prod_pres == null ? null : String(row.prod_pres),
    codebar: row.codebar == null ? null : String(row.codebar),
    troquel: row.troquel == null ? null : Number(row.troquel),
    unidades: row.unidades == null ? null : Number(row.unidades),
    activo: row.activo == null ? null : String(row.activo),
    refrigeracion: row.refrigeracion == null ? null : String(row.refrigeracion),
    idlaboratorio: row.idlaboratorio == null ? null : Number(row.idlaboratorio),
    idrubro: row.idrubro == null ? null : Number(row.idrubro),
    idsubrubro: row.idsubrubro == null ? null : Number(row.idsubrubro),
    idpsicofarmaco: row.idpsicofarmaco == null ? null : String(row.idpsicofarmaco),
    gtin: row.gtin == null ? null : String(row.gtin),
    costo: row.costo == null ? null : Number(row.costo),
    ultimoprecio: row.ultimoprecio == null ? null : Number(row.ultimoprecio),
  };
}

function mapMysqlRow(row: Record<string, unknown>): ProductoQuantioRow {
  return {
    idproducto: Number(row.IDProducto ?? row.idproducto),
    producto: row.Producto == null ? null : String(row.Producto),
    presentacion: row.Presentacion == null ? null : String(row.Presentacion),
    prod_pres: row.ProdPres == null ? null : String(row.ProdPres),
    codebar: row.Codebar == null ? null : String(row.Codebar),
    troquel: row.Troquel == null ? null : Number(row.Troquel),
    unidades: row.Unidades == null ? null : Number(row.Unidades),
    activo: row.Activo == null ? null : String(row.Activo),
    refrigeracion: row.Refrigeracion == null ? null : String(row.Refrigeracion),
    idlaboratorio: row.IDLaboratorio == null ? null : Number(row.IDLaboratorio),
    idrubro: row.IDRubro == null ? null : Number(row.IDRubro),
    idsubrubro: row.IDSubRubro == null ? null : Number(row.IDSubRubro),
    idpsicofarmaco: row.IDPsicofarmaco == null ? null : String(row.IDPsicofarmaco),
    gtin: row.gtin == null ? null : String(row.gtin),
    costo: row.Costo == null ? null : Number(row.Costo),
    ultimoprecio: row.UltimoPrecio == null ? null : Number(row.UltimoPrecio),
  };
}

export function productoQuantioAFicha(
  row: ProductoQuantioRow,
  laboratorioNombre?: string | null
): PadronProductoFicha {
  const descripcion =
    String(row.prod_pres ?? '').trim() ||
    [row.producto, row.presentacion].filter(Boolean).join(' ').trim() ||
    `Producto ${row.idproducto}`;

  return {
    producto_id_sistema: String(row.idproducto),
    codigo_barras: row.codebar?.trim() || row.gtin?.trim() || null,
    troquel: row.troquel,
    descripcion,
    presentacion: row.presentacion?.trim() || null,
    laboratorio: String(laboratorioNombre ?? '').trim() || null,
    cat_macro: null,
    fraccionable: row.unidades != null && row.unidades > 1 ? 1 : 0,
    refrigerado: String(row.refrigeracion ?? '').toUpperCase() === 'S',
    codigos_secundarios: [],
  };
}

/** Resuelve nombres de laboratorio (Supabase `laboratorios`) por CodLab / IDLaboratorio. */
export async function getNombresLaboratorioPorIds(
  admin: SupabaseClient,
  ids: Array<number | null | undefined>
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unicos = Array.from(
    new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))
  );
  if (unicos.length === 0) return out;

  const chunkSize = 500;
  for (let i = 0; i < unicos.length; i += chunkSize) {
    const lote = unicos.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from('laboratorios')
      .select('codlab, laborato')
      .in('codlab', lote);

    if (error) {
      console.warn('getNombresLaboratorioPorIds:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      const id = Number((row as { codlab?: number }).codlab);
      const nombre = String((row as { laborato?: string }).laborato ?? '').trim();
      if (Number.isFinite(id) && nombre) out.set(id, nombre);
    }
  }

  return out;
}

function fichaDesdeRow(
  row: ProductoQuantioRow,
  labs: Map<number, string>
): PadronProductoFicha {
  const labId = row.idlaboratorio;
  const labNombre =
    labId != null && Number.isFinite(labId) ? labs.get(labId) ?? null : null;
  return productoQuantioAFicha(row, labNombre);
}

export function fichaQuantioAProductoLegacy(
  ficha: PadronProductoFicha,
  stock?: {
    stock_sistema: number;
    stock_cajas?: number;
    stock_unidades?: number;
    unidades_por_caja?: number;
  } | null
): ProductoLegacy {
  const upc = stock?.unidades_por_caja ?? (ficha.fraccionable ? 1 : 1);
  const stockSistema = stock?.stock_sistema ?? 0;

  return {
    producto_id_sistema: ficha.producto_id_sistema,
    codigo_barras: ficha.codigo_barras,
    troquel: ficha.troquel,
    codigos_secundarios: ficha.codigos_secundarios,
    descripcion: ficha.descripcion,
    presentacion: ficha.presentacion,
    laboratorio: ficha.laboratorio,
    stock_sistema: stockSistema,
    stock_cajas: stock?.stock_cajas,
    stock_unidades: stock?.stock_unidades,
    unidades_por_caja: upc,
    fraccionable: ficha.fraccionable,
    refrigerado: ficha.refrigerado,
    sector: ficha.sector ?? null,
    modulo: ficha.modulo ?? null,
    fila: ficha.fila ?? null,
    posicion: ficha.posicion ?? null,
  };
}

export function fichaQuantioABusqueda(ficha: PadronProductoFicha) {
  return {
    producto_id_sistema: ficha.producto_id_sistema,
    codigo_barras: ficha.codigo_barras,
    troquel: ficha.troquel,
    descripcion: ficha.descripcion,
    presentacion: ficha.presentacion,
    laboratorio: ficha.laboratorio,
  };
}

export async function quantioProductosDisponible(
  admin?: SupabaseClient
): Promise<boolean> {
  if (admin) {
    const { count, error } = await admin
      .from('productos_quantio')
      .select('*', { count: 'exact', head: true })
      .limit(1);
    if (!error && (count ?? 0) > 0) return true;
  }
  return isQuantioDatabaseConfigured();
}

async function getProductoQuantioLiveById(id: number): Promise<ProductoQuantioRow | null> {
  if (!isQuantioDatabaseConfigured()) return null;
  const pool = getQuantioPool();
  const [rows] = await pool.query(
    `
      SELECT
        IDProducto, Producto, Presentacion, ProdPres, Codebar, Troquel, Unidades,
        Activo, Refrigeracion, IDLaboratorio, IDRubro, IDSubRubro, IDPsicofarmaco,
        gtin, Costo, UltimoPrecio
      FROM productos
      WHERE IDProducto = ?
      LIMIT 1
    `,
    [id]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapMysqlRow(row) : null;
}

async function getProductoQuantioLiveByBarcode(barcode: string): Promise<ProductoQuantioRow | null> {
  if (!isQuantioDatabaseConfigured()) return null;
  const pool = getQuantioPool();
  const code = barcode.trim();
  const [rows] = await pool.query(
    `
      SELECT
        IDProducto, Producto, Presentacion, ProdPres, Codebar, Troquel, Unidades,
        Activo, Refrigeracion, IDLaboratorio, IDRubro, IDSubRubro, IDPsicofarmaco,
        gtin, Costo, UltimoPrecio
      FROM productos
      WHERE Codebar = ? OR gtin = ? OR CAST(Troquel AS CHAR) = ?
      LIMIT 1
    `,
    [code, code, code]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapMysqlRow(row) : null;
}

export async function getProductoQuantioById(
  admin: SupabaseClient,
  id: number
): Promise<PadronProductoFicha | null> {
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data } = await admin
    .from('productos_quantio')
    .select('*')
    .eq('idproducto', id)
    .maybeSingle();

  if (data) {
    const row = mapSupabaseRow(data as Record<string, unknown>);
    const labs = await getNombresLaboratorioPorIds(admin, [row.idlaboratorio]);
    return fichaDesdeRow(row, labs);
  }

  const live = await getProductoQuantioLiveById(id);
  if (!live) return null;
  const labs = await getNombresLaboratorioPorIds(admin, [live.idlaboratorio]);
  return fichaDesdeRow(live, labs);
}

export async function getProductoQuantioByBarcode(
  admin: SupabaseClient,
  barcode: string
): Promise<PadronProductoFicha | null> {
  const code = barcode.trim();
  if (!code) return null;

  const { data: direct } = await admin
    .from('productos_quantio')
    .select('*')
    .eq('codebar', code)
    .limit(1)
    .maybeSingle();

  if (direct) {
    const row = mapSupabaseRow(direct as Record<string, unknown>);
    const labs = await getNombresLaboratorioPorIds(admin, [row.idlaboratorio]);
    return fichaDesdeRow(row, labs);
  }

  const { data: mapRow } = await admin
    .from('productoscodebars')
    .select('idproducto')
    .eq('codebar', code)
    .order('idproducto', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mapRow && typeof mapRow.idproducto === 'number') {
    const ficha = await getProductoQuantioById(admin, mapRow.idproducto);
    if (ficha) return ficha;
  }

  const { data: byTroquel } = await admin
    .from('productos_quantio')
    .select('*')
    .eq('troquel', Number(code))
    .limit(1)
    .maybeSingle();

  if (byTroquel) {
    const row = mapSupabaseRow(byTroquel as Record<string, unknown>);
    const labs = await getNombresLaboratorioPorIds(admin, [row.idlaboratorio]);
    return fichaDesdeRow(row, labs);
  }

  const live = await getProductoQuantioLiveByBarcode(code);
  if (!live) return null;
  const labs = await getNombresLaboratorioPorIds(admin, [live.idlaboratorio]);
  return fichaDesdeRow(live, labs);
}

export async function buscarProductosQuantio(
  admin: SupabaseClient,
  q: string,
  limit = 40
): Promise<PadronProductoFicha[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const safe = term.replace(/%/g, '').replace(/_/g, '');
  const pattern = `%${safe}%`;
  const troquelNum = Number(term);

  let orFilter = `prod_pres.ilike.${pattern},producto.ilike.${pattern},presentacion.ilike.${pattern},codebar.ilike.${pattern}`;
  if (Number.isFinite(troquelNum) && troquelNum > 0) {
    orFilter += `,troquel.eq.${troquelNum}`;
  }

  const { data, error } = await admin
    .from('productos_quantio')
    .select('*')
    .or(orFilter)
    .limit(limit);
  if (error) {
    console.error('buscarProductosQuantio:', error.message);
    return [];
  }

  const rows = (data ?? []).map((row) => mapSupabaseRow(row as Record<string, unknown>));
  const labs = await getNombresLaboratorioPorIds(
    admin,
    rows.map((r) => r.idlaboratorio)
  );
  return rows.map((row) => fichaDesdeRow(row, labs));
}

export async function getFichasDesdeProductosQuantio(
  admin: SupabaseClient,
  ids: number[]
): Promise<PadronProductoFicha[]> {
  const unicos = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (unicos.length === 0) return [];

  const rows: ProductoQuantioRow[] = [];
  const chunkSize = 500;

  for (let i = 0; i < unicos.length; i += chunkSize) {
    const lote = unicos.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from('productos_quantio')
      .select('*')
      .in('idproducto', lote);

    if (error) {
      console.warn('getFichasDesdeProductosQuantio:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      rows.push(mapSupabaseRow(row as Record<string, unknown>));
    }
  }

  const encontrados = new Set(rows.map((r) => r.idproducto));
  for (const id of unicos) {
    if (encontrados.has(id)) continue;
    const live = await getProductoQuantioLiveById(id);
    if (live) rows.push(live);
  }

  const labs = await getNombresLaboratorioPorIds(
    admin,
    rows.map((r) => r.idlaboratorio)
  );
  return rows.map((row) => fichaDesdeRow(row, labs));
}

/** Stock droguería: solo API oficial Quantio REST (CONSULTAR_STOCK, sucursal 1). */
export async function resolverStockQuantio(
  productoId: string,
  _allowMissingStock: boolean
): Promise<
  | {
      ok: true;
      stock: {
        stock_sistema: number;
        stock_cajas?: number;
        stock_unidades?: number;
        unidades_por_caja?: number;
      };
    }
  | { ok: false; failed: boolean }
> {
  const idProducto = Number(productoId);
  if (!Number.isFinite(idProducto)) {
    return { ok: false, failed: true };
  }

  const { getStockQuantioRestByProductoId, isQuantioRestConfigured } = await import(
    '@/lib/legacy-db/quantio-rest'
  );

  if (!isQuantioRestConfigured()) {
    console.warn('resolverStockQuantio: QUANTIO_REST_* no configurado');
    return { ok: false, failed: true };
  }

  const rest = await getStockQuantioRestByProductoId(idProducto);
  if (rest.ok) {
    return { ok: true, stock: rest.stock };
  }

  console.warn('resolverStockQuantio quantio-rest:', rest.error);
  return { ok: false, failed: true };
}
