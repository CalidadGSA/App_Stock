/**
 * Recorrido de las líneas con diferencia de un mes.
 *
 * Se hace en dos pasos —primero las cabeceras del mes y después el detalle por `control_id`—
 * porque el `join` inverso (`controles_inventario_detalle` + `controles_inventario!inner`)
 * sobre toda la tabla de detalle se pasa del `statement_timeout` de Supabase.
 * Los ids van en lotes: son uuid y viajan en la URL de PostgREST.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rangoMesCalendarioYm } from '@/lib/inventario/informe-mensual-metricas';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import { rangoFechasArgentinaIso } from '@/lib/utils';

/** Detalle por lote (PostgREST corta en 1000 filas). */
const DETALLE_CHUNK = 1000;
/** Controles por consulta (sus uuid van en la URL). */
const CONTROLES_LOTE = 100;

export type ControlMes = {
  id: string;
  sucursal_id: number;
  tipo: string | null;
  origen: string | null;
  fecha_fin: string | null;
  sucursal_nombre: string | null;
};

/** Controles cerrados cuya fecha de cierre cae en el mes (opcionalmente de una sucursal). */
export async function cargarControlesCerradosDelMes(
  admin: SupabaseClient,
  year: number,
  month1_12: number,
  opts?: { sucursalId?: number | null; soloVisiblesEnLogin?: boolean }
): Promise<ControlMes[]> {
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month1_12);
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fecha_inicio, fecha_fin);

  let q = admin
    .from('controles_inventario')
    .select('id, sucursal_id, tipo, origen, fecha_fin, sucursales(nombrefantasia)')
    .eq('estado', 'cerrado')
    .gte('fecha_fin', desdeIso)
    .lte('fecha_fin', hastaIso);

  if (opts?.sucursalId != null && Number.isFinite(opts.sucursalId)) {
    q = q.eq('sucursal_id', opts.sucursalId);
  }

  const { data, error } = await q;
  if (error) {
    console.error('cargarControlesCerradosDelMes:', error.message);
    return [];
  }

  const out: ControlMes[] = [];
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      sucursal_id: number;
      tipo: string | null;
      origen: string | null;
      fecha_fin: string | null;
      sucursales?: { nombrefantasia?: string | null } | null;
    };
    const sid = Number(r.sucursal_id);
    if (opts?.soloVisiblesEnLogin !== false && !esSucursalVisibleEnLogin(sid)) continue;
    out.push({
      id: String(r.id),
      sucursal_id: sid,
      tipo: r.tipo ?? null,
      origen: r.origen ?? null,
      fecha_fin: r.fecha_fin ?? null,
      sucursal_nombre: r.sucursales?.nombrefantasia ?? null,
    });
  }
  return out;
}

/**
 * Llama a `onBatch` con cada lote de líneas `con_diferencias = 1` de los controles indicados.
 * `columnas` es el `select` de PostgREST (sin el join: el control ya se conoce).
 */
export async function recorrerDetallesConDiferencia<T>(
  admin: SupabaseClient,
  controlIds: string[],
  columnas: string,
  onBatch: (filas: T[]) => Promise<void> | void,
  etiquetaLog = 'recorrerDetallesConDiferencia'
): Promise<void> {
  for (let i = 0; i < controlIds.length; i += CONTROLES_LOTE) {
    const lote = controlIds.slice(i, i + CONTROLES_LOTE);
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from('controles_inventario_detalle')
        .select(columnas)
        .in('control_id', lote)
        .eq('con_diferencias', 1)
        .order('id', { ascending: true })
        .range(offset, offset + DETALLE_CHUNK - 1);

      if (error) {
        console.error(`${etiquetaLog}:`, error.message);
        break;
      }
      const batch = (data ?? []) as T[];
      if (batch.length > 0) await onBatch(batch);
      if (batch.length < DETALLE_CHUNK) break;
      offset += DETALLE_CHUNK;
    }
  }
}
