import { createAdminClient } from '@/lib/supabase/server';

const VENTAS_DETALLE_CHUNK = 200;

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/** Suma `cantidad_vendida` de `vencimientos_detalle_ventas` por `detalle_id`. */
export async function sumarCantidadVendidaPorDetalle(
  admin: AdminClient,
  detalleIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (detalleIds.length === 0) return map;
  for (let i = 0; i < detalleIds.length; i += VENTAS_DETALLE_CHUNK) {
    const chunk = detalleIds.slice(i, i + VENTAS_DETALLE_CHUNK);
    const { data, error } = await admin
      .from('vencimientos_detalle_ventas')
      .select('detalle_id, cantidad_vendida')
      .in('detalle_id', chunk);
    if (error) {
      console.error('vencimientos_detalle_ventas (suma):', error.message);
      return map;
    }
    for (const row of data ?? []) {
      const r = row as { detalle_id: string; cantidad_vendida: number | string };
      const id = String(r.detalle_id);
      const q = Number(r.cantidad_vendida ?? 0);
      if (!Number.isFinite(q)) continue;
      map.set(id, (map.get(id) ?? 0) + q);
    }
  }
  return map;
}
