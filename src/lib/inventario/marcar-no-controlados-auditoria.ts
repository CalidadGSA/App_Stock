import type { SupabaseClient } from '@supabase/supabase-js';
import { detalleInventarioEstaContado } from '@/lib/inventario/consolidar-diferencias-detalle';
import {
  esTipoOrigenDiferenciasParaAuditoria,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';

type DetallePendiente = {
  id: string;
  producto_id_sistema: string;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_sistema?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
};

/**
 * En auditoría de stock: marca líneas sin contar como controladas
 * (stock real = stock sistema / 0) y libera `auditado` en el origen de sucursal
 * para que vuelvan a salir en la próxima auditoría.
 */
export async function marcarNoControladosAuditoriaYLiberarOrigen(
  admin: SupabaseClient,
  controlId: string,
  sucursalId: number
): Promise<{ marcados: number; liberados: number }> {
  const { data: detalles, error } = await admin
    .from('controles_inventario_detalle')
    .select(
      'id, producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_sistema, stock_real_cajas, stock_real_unidades'
    )
    .eq('control_id', controlId);

  if (error) throw new Error(error.message);

  const pendientes = ((detalles ?? []) as DetallePendiente[]).filter(
    (d) => !detalleInventarioEstaContado(d)
  );
  if (pendientes.length === 0) return { marcados: 0, liberados: 0 };

  let marcados = 0;
  for (const d of pendientes) {
    const sistC = d.stock_sist_cajas != null ? Number(d.stock_sist_cajas) : 0;
    const sistU = d.stock_sist_unidades != null ? Number(d.stock_sist_unidades) : 0;
    const stockSistema =
      d.stock_sistema != null && Number.isFinite(Number(d.stock_sistema))
        ? Number(d.stock_sistema)
        : sistC + sistU;

    const { error: updErr } = await admin
      .from('controles_inventario_detalle')
      .update({
        stock_sist_cajas: sistC,
        stock_sist_unidades: sistU,
        stock_sistema: stockSistema,
        stock_real_cajas: sistC,
        stock_real_unidades: sistU,
        stock_real: stockSistema,
        diferencia: 0,
        con_diferencias: 0,
        estado: 'auditado',
        auditado: 1,
      })
      .eq('id', d.id);

    if (updErr) {
      console.error('marcarNoControladosAuditoria:', updErr.message, { detalleId: d.id });
      continue;
    }
    marcados += 1;
  }

  const idsProducto = Array.from(
    new Set(
      pendientes
        .map((d) => String(d.producto_id_sistema ?? '').trim())
        .filter((id) => id.length > 0)
    )
  );
  if (idsProducto.length === 0) return { marcados, liberados: 0 };

  // Controles de sucursal (origen de las diferencias) en esta sucursal.
  const { data: controlesSuc, error: ctrlErr } = await admin
    .from('controles_inventario')
    .select('id, origen, tipo, descripcion')
    .eq('sucursal_id', sucursalId)
    .neq('id', controlId);

  if (ctrlErr) throw new Error(ctrlErr.message);

  const idsControlesOrigen = (controlesSuc ?? [])
    .filter((c) =>
      esTipoOrigenDiferenciasParaAuditoria(
        inferirTipoControlInventario(
          c as { origen?: string | null; tipo?: string | null; descripcion?: string | null }
        )
      )
    )
    .map((c) => String((c as { id: string }).id));

  if (idsControlesOrigen.length === 0) return { marcados, liberados: 0 };

  // Liberar flag auditado en el origen para que vuelvan a la cola.
  // En lotes: los ids van en la URL y una sucursal con cientos de controles la desborda.
  const LOTE = 100;
  let liberados = 0;
  for (let i = 0; i < idsControlesOrigen.length; i += LOTE) {
    const loteControles = idsControlesOrigen.slice(i, i + LOTE);
    for (let j = 0; j < idsProducto.length; j += LOTE) {
      const { data: liberadosRows, error: libErr } = await admin
        .from('controles_inventario_detalle')
        .update({ auditado: 0 })
        .in('control_id', loteControles)
        .in('producto_id_sistema', idsProducto.slice(j, j + LOTE))
        .eq('auditado', 1)
        .select('id');

      if (libErr) throw new Error(libErr.message);
      liberados += liberadosRows?.length ?? 0;
    }
  }

  return { marcados, liberados };
}
