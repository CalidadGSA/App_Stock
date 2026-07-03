import type { SupabaseClient } from '@supabase/supabase-js';

type DetalleInventario = {
  id: string;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
  stock_sistema?: number | null;
  stock_real?: number | null;
  diferencia?: number | null;
};

export function detalleInventarioTieneDiferencia(d: DetalleInventario): boolean {
  const sistC = d.stock_sist_cajas;
  const sistU = d.stock_sist_unidades;
  const realC = d.stock_real_cajas;
  const realU = d.stock_real_unidades;

  if (sistC != null && sistU != null && realC != null && realU != null) {
    return realC - sistC !== 0 || realU - sistU !== 0;
  }

  const diffTotal = Number(d.diferencia ?? 0);
  if (diffTotal !== 0) return true;

  const ss = d.stock_sistema != null ? Number(d.stock_sistema) : null;
  const sr = d.stock_real != null ? Number(d.stock_real) : null;
  if (ss != null && sr != null && ss !== sr) return true;

  return false;
}

export function detalleInventarioEstaContado(d: DetalleInventario): boolean {
  return d.stock_real_cajas != null || d.stock_real_unidades != null;
}

/** Persiste con_diferencias/estado según stock sistema vs real antes de cerrar el control. */
export async function consolidarDiferenciasDetalleControl(
  admin: SupabaseClient,
  controlId: string
): Promise<{ lineasActualizadas: number; lineasConDiferencia: number }> {
  const { data: detalles, error } = await admin
    .from('controles_inventario_detalle')
    .select(
      'id, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, stock_sistema, stock_real, diferencia'
    )
    .eq('control_id', controlId);

  if (error) throw new Error(error.message);

  let lineasActualizadas = 0;
  let lineasConDiferencia = 0;

  for (const raw of detalles ?? []) {
    const d = raw as DetalleInventario;
    if (!detalleInventarioEstaContado(d)) continue;

    const conDiferencias = detalleInventarioTieneDiferencia(d) ? 1 : 0;
    if (conDiferencias) lineasConDiferencia += 1;

    const estado = conDiferencias ? 'con_diferencia' : 'sin_diferencias';

    const { error: updErr } = await admin
      .from('controles_inventario_detalle')
      .update({
        con_diferencias: conDiferencias,
        estado,
      })
      .eq('id', d.id);

    if (updErr) {
      console.error('consolidarDiferenciasDetalleControl:', updErr.message, { detalleId: d.id });
      continue;
    }
    lineasActualizadas += 1;
  }

  return { lineasActualizadas, lineasConDiferencia };
}
