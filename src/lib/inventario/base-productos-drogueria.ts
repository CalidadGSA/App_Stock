import type { SupabaseClient } from '@supabase/supabase-js';
import type { PadronProductoFicha } from '@/lib/padron-productos-lookup';
import {
  esCategoriaMacroSinPadron,
  filtrarQueryBaseProductosPorMacro,
  type CategoriaMacroInventarioDiario,
} from '@/lib/inventario/categoria-macro';
import { leerVueltasPsicosSucursal } from '@/lib/inventario/vueltas-psicos-sucursal';
import type { UbicacionDrogueria } from '@/lib/inventario/ubicacion-drogueria';

export type { UbicacionDrogueria } from '@/lib/inventario/ubicacion-drogueria';
export { formatearUbicacionDrogueria } from '@/lib/inventario/ubicacion-drogueria';

export const TABLA_BASE_PRODUCTOS_DROGUERIA = 'base_productos_drogueria';

export type BaseProductoDrogueriaRow = {
  idproducto: number;
  categoriamacro: string | null;
  sector: number | null;
  modulo: string | null;
  fila: number | null;
  posicion: number | null;
  producto: string | null;
  presentacion: string | null;
  orden: number | null;
  trimestre: string;
  vecesinventariado: number;
  fechainicio: string;
  fechafin: string;
};

export async function obtenerTrimestreVigenteDrogueria(
  admin: SupabaseClient,
  hoyYmd: string,
  categoriaMacro?: string | null
): Promise<{ trimestre: string; fechainicio: string; fechafin: string } | null> {
  let query = admin
    .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
    .select('trimestre, fechainicio, fechafin')
    .lte('fechainicio', hoyYmd)
    .gte('fechafin', hoyYmd)
    .limit(1);

  if (categoriaMacro && !esCategoriaMacroSinPadron(categoriaMacro)) {
    query = query.ilike('categoriamacro', categoriaMacro);
  }

  const { data, error } = await query;
  if (error) {
    console.error('obtenerTrimestreVigenteDrogueria:', error.message);
    return null;
  }
  const row = data?.[0] as
    | { trimestre?: string; fechainicio?: string; fechafin?: string }
    | undefined;
  const trimestre = String(row?.trimestre ?? '').trim();
  if (!trimestre) return null;
  return {
    trimestre,
    fechainicio: String(row?.fechainicio ?? '').trim(),
    fechafin: String(row?.fechafin ?? '').trim(),
  };
}

export async function seleccionarIdsInventarioDiarioDrogueria(
  admin: SupabaseClient,
  categoriaMacro: CategoriaMacroInventarioDiario,
  trimestreActual: string,
  objetivo: number,
  idsExcluidos: Set<number>
): Promise<number[]> {
  if (objetivo <= 0) return [];

  const seleccionados: number[] = [];
  const vistos = new Set<number>();

  if (categoriaMacro === 'PSICOTROPICOS') {
    const vueltasMax = await leerVueltasPsicosSucursal(admin, 13);

    const { data: baseRows, error } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('idproducto, vecesinventariado, sector, modulo, fila, posicion, orden')
      .ilike('categoriamacro', categoriaMacro)
      .eq('trimestre', trimestreActual)
      .lt('vecesinventariado', vueltasMax)
      .order('vecesinventariado', { ascending: true })
      .order('sector', { ascending: true })
      .order('modulo', { ascending: true })
      .order('fila', { ascending: true })
      .order('posicion', { ascending: true })
      .order('orden', { ascending: true });

    if (error) throw error;

    const rows = (baseRows ?? []) as Array<{ idproducto: number; vecesinventariado: number }>;
    const niveles = Array.from(new Set(rows.map((row) => Number(row.vecesinventariado) || 0)));

    for (const nivel of niveles) {
      for (const row of rows) {
        if (Number(row.vecesinventariado) !== nivel) continue;
        const id = Number(row.idproducto);
        if (!Number.isFinite(id) || vistos.has(id) || idsExcluidos.has(id)) continue;
        vistos.add(id);
        seleccionados.push(id);
        if (seleccionados.length === objetivo) return seleccionados;
      }
    }
    return seleccionados;
  }

  let offset = 0;
  const fetchSize = 200;

  while (seleccionados.length < objetivo) {
    const { data: baseRows, error } = await filtrarQueryBaseProductosPorMacro(
      admin
        .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
        .select('idproducto')
        .eq('trimestre', trimestreActual)
        .eq('vecesinventariado', 0)
        .order('sector', { ascending: true })
        .order('modulo', { ascending: true })
        .order('fila', { ascending: true })
        .order('posicion', { ascending: true })
        .order('orden', { ascending: true })
        .range(offset, offset + fetchSize - 1),
      categoriaMacro
    );

    if (error) throw error;
    if (!baseRows || baseRows.length === 0) break;

    for (const r of baseRows as Array<{ idproducto: number }>) {
      const id = Number(r.idproducto);
      if (!Number.isFinite(id) || vistos.has(id) || idsExcluidos.has(id)) continue;
      vistos.add(id);
      seleccionados.push(id);
      if (seleccionados.length === objetivo) break;
    }

    offset += baseRows.length;
  }

  return seleccionados;
}

export async function getUbicacionesDrogueriaPorIds(
  admin: SupabaseClient,
  ids: number[],
  trimestre?: string | null
): Promise<Map<number, UbicacionDrogueria & { producto?: string | null; presentacion?: string | null }>> {
  const out = new Map<
    number,
    UbicacionDrogueria & { producto?: string | null; presentacion?: string | null }
  >();
  const unicos = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (unicos.length === 0) return out;

  const chunkSize = 500;
  for (let i = 0; i < unicos.length; i += chunkSize) {
    const lote = unicos.slice(i, i + chunkSize);
    let q = admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('idproducto, sector, modulo, fila, posicion, producto, presentacion, trimestre')
      .in('idproducto', lote);

    if (trimestre) {
      q = q.eq('trimestre', trimestre);
    }

    const { data, error } = await q;
    if (error) {
      console.warn('getUbicacionesDrogueriaPorIds:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      const id = Number((row as { idproducto: number }).idproducto);
      if (!Number.isFinite(id) || out.has(id)) continue;
      out.set(id, {
        sector: (row as { sector?: number | null }).sector ?? null,
        modulo: (row as { modulo?: string | null }).modulo ?? null,
        fila: (row as { fila?: number | null }).fila ?? null,
        posicion: (row as { posicion?: number | null }).posicion ?? null,
        producto: (row as { producto?: string | null }).producto ?? null,
        presentacion: (row as { presentacion?: string | null }).presentacion ?? null,
      });
    }
  }

  return out;
}

/** Completa sector/módulo/fila/posición (y nombre) desde el padrón trimestral vigente. */
export async function enriquecerFichaConUbicacionDrogueria(
  admin: SupabaseClient,
  ficha: PadronProductoFicha,
  hoyYmd?: string
): Promise<PadronProductoFicha> {
  const id = Number(ficha.producto_id_sistema);
  if (!Number.isFinite(id)) return ficha;

  const hoy =
    hoyYmd ??
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const vigente = await obtenerTrimestreVigenteDrogueria(admin, hoy);
  const map = await getUbicacionesDrogueriaPorIds(admin, [id], vigente?.trimestre ?? null);
  const ub = map.get(id);
  if (!ub) return ficha;

  return {
    ...ficha,
    descripcion: String(ub.producto ?? '').trim() || ficha.descripcion,
    presentacion:
      ub.presentacion != null && String(ub.presentacion).trim() !== ''
        ? String(ub.presentacion)
        : ficha.presentacion,
    sector: ub.sector,
    modulo: ub.modulo,
    fila: ub.fila,
    posicion: ub.posicion,
  };
}

export async function getFichasDesdeBaseProductosDrogueria(
  admin: SupabaseClient,
  ids: number[],
  trimestre?: string | null
): Promise<PadronProductoFicha[]> {
  const ubicaciones = await getUbicacionesDrogueriaPorIds(admin, ids, trimestre);
  const { getFichasDesdeProductosQuantio } = await import('@/lib/quantio-productos-lookup');
  const quantio = await getFichasDesdeProductosQuantio(admin, ids);
  const quantioPorId = new Map(quantio.map((f) => [Number(f.producto_id_sistema), f]));

  return ids.flatMap((id) => {
    if (!Number.isFinite(id) || id <= 0) return [];
    const ub = ubicaciones.get(id);
    const q = quantioPorId.get(id);
    const descripcion =
      String(ub?.producto ?? '').trim() ||
      q?.descripcion ||
      `Producto ${id}`;
    const presentacion =
      ub?.presentacion != null && String(ub.presentacion).trim() !== ''
        ? String(ub.presentacion)
        : q?.presentacion ?? null;

    return [
      {
        producto_id_sistema: String(id),
        codigo_barras: q?.codigo_barras ?? null,
        troquel: q?.troquel ?? null,
        descripcion,
        presentacion,
        laboratorio: q?.laboratorio ?? null,
        cat_macro: null,
        fraccionable: q?.fraccionable,
        refrigerado: q?.refrigerado,
        codigos_secundarios: q?.codigos_secundarios ?? [],
        sector: ub?.sector ?? null,
        modulo: ub?.modulo ?? null,
        fila: ub?.fila ?? null,
        posicion: ub?.posicion ?? null,
      },
    ];
  });
}

/** Incrementa vecesinventariado en base_productos_drogueria (sin RPC). */
export async function incrementarVecesInventariadoDrogueria(
  admin: SupabaseClient,
  trimestre: string,
  idProductos: number[]
): Promise<void> {
  const unicos = Array.from(new Set(idProductos.filter((n) => Number.isFinite(n) && n > 0)));
  for (const id of unicos) {
    const { data, error } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('vecesinventariado')
      .eq('idproducto', id)
      .eq('trimestre', trimestre)
      .maybeSingle();

    if (error) {
      console.warn('incrementarVecesInventariadoDrogueria read:', error.message, { id });
      continue;
    }

    const actual = Number((data as { vecesinventariado?: number } | null)?.vecesinventariado ?? 0);
    const { error: updError } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .update({ vecesinventariado: actual + 1 })
      .eq('idproducto', id)
      .eq('trimestre', trimestre);

    if (updError) {
      console.warn('incrementarVecesInventariadoDrogueria update:', updError.message, { id });
    }
  }
}

export async function sumarVecesInventariadoPsicotropicosDrogueria(
  admin: SupabaseClient,
  trimestreDb: string
): Promise<{ cantidadProductos: number; sumaVecesInventariado: number }> {
  const chunkSize = 1000;
  let offset = 0;
  let cantidadProductos = 0;
  let sumaVecesInventariado = 0;

  while (true) {
    const { data, error } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('vecesinventariado')
      .eq('trimestre', trimestreDb)
      .ilike('categoriamacro', 'PSICOTROPICOS')
      .range(offset, offset + chunkSize - 1);

    if (error) {
      console.error('sumarVecesInventariadoPsicotropicosDrogueria:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      const veces = Number((row as { vecesinventariado?: number }).vecesinventariado ?? 0);
      cantidadProductos += 1;
      sumaVecesInventariado += Number.isFinite(veces) && veces > 0 ? veces : 0;
    }

    if (batch.length < chunkSize) break;
    offset += chunkSize;
  }

  return { cantidadProductos, sumaVecesInventariado };
}

export async function obtenerProgresoPorMacroDrogueria(
  admin: SupabaseClient,
  trimestreDb: string,
  vueltasPsicos: number
): Promise<
  Array<{
    macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS';
    total: number;
    inventariados: number;
    pendientes: number;
    porcentaje: number;
  }>
> {
  const { calcularProgresoPsicotropicos } = await import(
    '@/lib/inventario/vueltas-psicos-sucursal'
  );
  const macros = ['FARMA', 'BIENESTAR', 'PSICOTROPICOS'] as const;
  const porMacro = [];

  for (const macro of macros) {
    if (macro === 'PSICOTROPICOS') {
      const { cantidadProductos, sumaVecesInventariado } =
        await sumarVecesInventariadoPsicotropicosDrogueria(admin, trimestreDb);
      const psico = calcularProgresoPsicotropicos(
        cantidadProductos,
        sumaVecesInventariado,
        vueltasPsicos
      );
      porMacro.push({ macro, ...psico });
      continue;
    }

    const { count: total, error: errTotal } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestreDb)
      .ilike('categoriamacro', macro);

    if (errTotal) continue;

    const { count: inventariados, error: errInv } = await admin
      .from(TABLA_BASE_PRODUCTOS_DROGUERIA)
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestreDb)
      .ilike('categoriamacro', macro)
      .gt('vecesinventariado', 0);

    if (errInv) continue;

    const t = total ?? 0;
    const inv = inventariados ?? 0;
    porMacro.push({
      macro,
      total: t,
      inventariados: inv,
      pendientes: Math.max(0, t - inv),
      porcentaje: t > 0 ? Math.round((inv / t) * 100) : 0,
    });
  }

  return porMacro;
}
