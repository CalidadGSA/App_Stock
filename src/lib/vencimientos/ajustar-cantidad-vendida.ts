import type { createAdminClient } from '@/lib/supabase/server';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

export type AjustarCantidadVendidaResult =
  | {
      ok: true;
      cantidad_vendida_total: number;
      cantidad_restante: number;
      vendido: number;
      cantidad_linea: number;
    }
  | { ok: false; error: string; status: number };

/** Reajusta el total vendido de una línea (0 … cantidad cargada en la línea). */
export async function ajustarCantidadVendidaDetalle(args: {
  admin: AdminClient;
  detalleId: string;
  sucursalId: number;
  usuarioId: number;
  cantidadVendidaTotal: number;
}): Promise<AjustarCantidadVendidaResult> {
  const { admin, detalleId, sucursalId, usuarioId } = args;
  const nuevaVendida = Math.floor(Number(args.cantidadVendidaTotal));

  if (!Number.isFinite(nuevaVendida) || nuevaVendida < 0) {
    return { ok: false, error: 'La cantidad vendida debe ser un entero mayor o igual a 0.', status: 400 };
  }

  const { data: row, error: rowError } = await admin
    .from('controles_vencimientos_detalle')
    .select('id, control_id, cantidad, eliminado, vendido, controles_vencimientos!inner(sucursal_id)')
    .eq('id', detalleId)
    .maybeSingle();

  if (rowError) return { ok: false, error: rowError.message, status: 500 };
  if (!row) return { ok: false, error: 'Registro no encontrado', status: 404 };

  const r = row as {
    cantidad?: number;
    eliminado?: number;
    control_id?: string;
    controles_vencimientos?: { sucursal_id?: number };
  };

  if (String(r.controles_vencimientos?.sucursal_id) !== String(sucursalId)) {
    return { ok: false, error: 'Sin acceso', status: 403 };
  }
  if (Number(r.eliminado ?? 0) === 1) {
    return { ok: false, error: 'La línea fue eliminada por error de carga.', status: 400 };
  }

  const ventasMap = await sumarCantidadVendidaPorDetalle(admin, [detalleId]);
  const vendidaActual = ventasMap.get(detalleId) ?? 0;
  const restanteActual = Number(r.cantidad ?? 0);
  const cantidadLinea = restanteActual + vendidaActual;

  if (!Number.isFinite(cantidadLinea) || cantidadLinea <= 0) {
    return { ok: false, error: 'La línea no tiene cantidad cargada para ajustar.', status: 400 };
  }
  if (nuevaVendida > cantidadLinea) {
    return {
      ok: false,
      error: `No podés registrar más de ${cantidadLinea} unidades vendidas en esta línea (cantidad cargada).`,
      status: 400,
    };
  }
  if (nuevaVendida === vendidaActual) {
    return { ok: false, error: 'La cantidad vendida ingresada es igual a la actual.', status: 400 };
  }

  const nuevaRestante = cantidadLinea - nuevaVendida;
  const delta = nuevaVendida - vendidaActual;

  const { error: upErr } = await admin
    .from('controles_vencimientos_detalle')
    .update({
      cantidad: nuevaRestante,
      vendido: nuevaRestante <= 0 ? 1 : 0,
    })
    .eq('id', detalleId);

  if (upErr) return { ok: false, error: upErr.message, status: 500 };

  const { error: ventaErr } = await admin.from('vencimientos_detalle_ventas').insert({
    detalle_id: detalleId,
    cantidad_vendida: delta,
    cantidad_restante_despues: nuevaRestante,
    linea_vendida_completa: nuevaRestante <= 0 ? 1 : 0,
    usuario_id: usuarioId,
    sucursal_id: sucursalId,
    es_ajuste: 1,
  });

  if (ventaErr) {
    await admin
      .from('controles_vencimientos_detalle')
      .update({ cantidad: restanteActual, vendido: restanteActual <= 0 ? 1 : 0 })
      .eq('id', detalleId);
    return {
      ok: false,
      error: `No se pudo registrar el ajuste: ${ventaErr.message}`,
      status: 500,
    };
  }

  const controlId = String(r.control_id ?? '');
  if (controlId) {
    await admin
      .from('controles_vencimientos')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', controlId);
  }

  return {
    ok: true,
    cantidad_vendida_total: nuevaVendida,
    cantidad_restante: nuevaRestante,
    vendido: nuevaRestante <= 0 ? 1 : 0,
    cantidad_linea: cantidadLinea,
  };
}
