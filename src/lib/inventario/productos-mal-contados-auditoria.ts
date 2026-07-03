import type { SupabaseClient } from '@supabase/supabase-js';
import { esDiferenciaDeControlAuditoria } from '@/lib/inventario/diferencias-resumen-carga';
import {
  calcularDiferenciaCajasUnidades,
  cargarDiferenciasSucursalPorProducto,
  diferenciaSucursalParaProducto,
  esAjusteSucursalInversoAuditoria,
} from '@/lib/inventario/diferencia-sucursal-auditoria';
import { rangoFechasArgentinaIso } from '@/lib/utils';

const CHUNK = 1000;

type FilaDetalleAuditoria = {
  producto_id_sistema?: string | null;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
  controles_inventario?: {
    sucursal_id?: number | null;
    origen?: string | null;
    tipo?: string | null;
  } | Array<{
    sucursal_id?: number | null;
    origen?: string | null;
    tipo?: string | null;
  }>;
};

/**
 * Líneas con diferencia en controles de auditoría cerrados en el período cuyo ajuste
 * sucursal (auditado = 1) tiene el mismo valor en cajas y unidades pero signo opuesto.
 */
export async function contarLineasMalContadasAuditoriaPeriodo(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string,
  sucId?: number
): Promise<number> {
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fechaInicio, fechaFin);
  let total = 0;
  let offset = 0;

  while (true) {
    let q = admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, controles_inventario!inner(sucursal_id, estado, fecha_fin, origen, tipo)'
      )
      .eq('controles_inventario.estado', 'cerrado')
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lte('controles_inventario.fecha_fin', hastaIso)
      .eq('con_diferencias', 1)
      .order('id', { ascending: true })
      .range(offset, offset + CHUNK - 1);

    if (sucId != null) {
      q = q.eq('controles_inventario.sucursal_id', sucId);
    }

    const { data, error } = await q;
    if (error) {
      console.error('contarLineasMalContadasAuditoriaPeriodo:', error.message);
      break;
    }

    const batch = (data ?? []) as FilaDetalleAuditoria[];
    if (batch.length === 0) break;

    const porSucursal = new Map<number, FilaDetalleAuditoria[]>();

    for (const row of batch) {
      const controlRaw = row.controles_inventario;
      const control = Array.isArray(controlRaw) ? controlRaw[0] : controlRaw;
      if (!esDiferenciaDeControlAuditoria(control)) continue;

      const suc = Number(control?.sucursal_id);
      if (!Number.isFinite(suc)) continue;

      const pid = String(row.producto_id_sistema ?? '').trim();
      if (!pid) continue;

      const lista = porSucursal.get(suc) ?? [];
      lista.push(row);
      porSucursal.set(suc, lista);
    }

    for (const [sucursalId, filas] of porSucursal) {
      const productoIds = filas
        .map((f) => String(f.producto_id_sistema ?? '').trim())
        .filter(Boolean);
      const difSucursalMap = await cargarDiferenciasSucursalPorProducto(
        admin,
        sucursalId,
        productoIds
      );

      for (const row of filas) {
        const pid = String(row.producto_id_sistema ?? '').trim();
        const difAud = calcularDiferenciaCajasUnidades(
          row.stock_sist_cajas,
          row.stock_sist_unidades,
          row.stock_real_cajas,
          row.stock_real_unidades
        );
        if (!difAud) continue;

        const difSuc = diferenciaSucursalParaProducto(difSucursalMap, pid);
        if (
          esAjusteSucursalInversoAuditoria(
            difAud.cajas,
            difAud.unidades,
            difSuc?.cajas,
            difSuc?.unidades
          )
        ) {
          total += 1;
        }
      }
    }

    if (batch.length < CHUNK) break;
    offset += CHUNK;
  }

  return total;
}
