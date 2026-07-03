import type { SupabaseClient } from '@supabase/supabase-js';

export type DiferenciaSucursalCajasUnidades = {
  cajas: number;
  unidades: number;
};

function clavesProductoId(id: string | number | null | undefined): string[] {
  const s = String(id ?? '').trim();
  if (!s) return [];
  const keys = new Set<string>([s]);
  const n = Number(s);
  if (Number.isFinite(n)) keys.add(String(n));
  return Array.from(keys);
}

export function calcularDiferenciaCajasUnidades(
  stockSistCajas: number | null | undefined,
  stockSistUnidades: number | null | undefined,
  stockRealCajas: number | null | undefined,
  stockRealUnidades: number | null | undefined
): DiferenciaSucursalCajasUnidades | null {
  if (
    stockSistCajas == null &&
    stockSistUnidades == null &&
    stockRealCajas == null &&
    stockRealUnidades == null
  ) {
    return null;
  }
  const sistC = Number(stockSistCajas ?? 0);
  const sistU = Number(stockSistUnidades ?? 0);
  const realC = Number(stockRealCajas ?? 0);
  const realU = Number(stockRealUnidades ?? 0);
  return {
    cajas: realC - sistC,
    unidades: realU - sistU,
  };
}

type FilaOrigenSucursal = {
  producto_id_sistema: string;
  stock_sist_cajas: number | null;
  stock_sist_unidades: number | null;
  stock_real_cajas: number | null;
  stock_real_unidades: number | null;
  fecha_registro: string | null;
};

/**
 * Diferencia que la sucursal marcó al ajustar (línea origen con `auditado = 1`).
 */
export async function cargarDiferenciasSucursalPorProducto(
  admin: SupabaseClient,
  sucursalId: number,
  productoIds: string[]
): Promise<Map<string, DiferenciaSucursalCajasUnidades>> {
  const out = new Map<string, DiferenciaSucursalCajasUnidades>();
  const ids = Array.from(
    new Set(productoIds.map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (ids.length === 0 || !Number.isFinite(sucursalId)) return out;

  const chunkSize = 400;
  const porProducto = new Map<string, FilaOrigenSucursal>();

  for (let i = 0; i < ids.length; i += chunkSize) {
    const lote = ids.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, fecha_registro, controles_inventario!inner(sucursal_id)'
      )
      .eq('controles_inventario.sucursal_id', sucursalId)
      .eq('auditado', 1)
      .in('producto_id_sistema', lote)
      .order('fecha_registro', { ascending: true });

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as FilaOrigenSucursal[]) {
      const pid = String(row.producto_id_sistema ?? '').trim();
      if (!pid) continue;
      const canon = clavesProductoId(pid)[0] ?? pid;
      if (!porProducto.has(canon)) {
        porProducto.set(canon, row);
      }
    }
  }

  for (const [pid, row] of porProducto) {
    const dif = calcularDiferenciaCajasUnidades(
      row.stock_sist_cajas,
      row.stock_sist_unidades,
      row.stock_real_cajas,
      row.stock_real_unidades
    );
    if (!dif) continue;
    for (const k of clavesProductoId(pid)) {
      out.set(k, dif);
    }
  }

  return out;
}

export function diferenciaSucursalParaProducto(
  map: Map<string, DiferenciaSucursalCajasUnidades>,
  productoId: string
): DiferenciaSucursalCajasUnidades | null {
  for (const k of clavesProductoId(productoId)) {
    const hit = map.get(k);
    if (hit) return hit;
  }
  return null;
}

/** Ajuste sucursal con el mismo valor en cajas y unidades que la dif. auditoría pero signo opuesto. */
export function esAjusteSucursalInversoAuditoria(
  diffAuditoriaCajas: number,
  diffAuditoriaUnidades: number,
  difSucursalCajas: number | null | undefined,
  difSucursalUnidades: number | null | undefined
): boolean {
  if (difSucursalCajas == null && difSucursalUnidades == null) return false;
  const sucC = Number(difSucursalCajas ?? 0);
  const sucU = Number(difSucursalUnidades ?? 0);
  if (diffAuditoriaCajas === 0 && diffAuditoriaUnidades === 0) return false;
  return sucC === -diffAuditoriaCajas && sucU === -diffAuditoriaUnidades;
}
