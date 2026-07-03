import type { SupabaseClient } from '@supabase/supabase-js';
import { cerrarControlInventario } from '@/lib/inventario/cerrar-control-inventario';
import { medianocheHoyArgentinaIso } from '@/lib/utils';

export const HORAS_ABIERTO_CIERRE_AUTOMATICO_DEFAULT = 168;

export interface CierreInventariosVencidosResult {
  candidatos: number;
  cerrados: number;
  omitidos: number;
  errores: Array<{ controlId: string; message: string }>;
  fechaCierre: string;
  horasAbiertas: number;
}

export async function listarControlesInventarioParaCierreAutomatico(
  admin: SupabaseClient,
  horasAbiertas: number,
  ahoraMs = Date.now()
): Promise<Array<{ id: string; fecha_inicio: string; sucursal_id: number }>> {
  const cutoffIso = new Date(ahoraMs - horasAbiertas * 3600_000).toISOString();

  const acumulado: Array<{ id: string; fecha_inicio: string; sucursal_id: number }> = [];
  const pageSize = 500;
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_inventario')
      .select('id, fecha_inicio, sucursal_id')
      .eq('estado', 'en_progreso')
      .lte('fecha_inicio', cutoffIso)
      .order('fecha_inicio', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as Array<{ id: string; fecha_inicio: string; sucursal_id: number }>;
    acumulado.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return acumulado;
}

export async function ejecutarCierreInventariosVencidos(
  admin: SupabaseClient,
  opts?: {
    horasAbiertas?: number;
    fechaCierreIso?: string;
    ahoraMs?: number;
  }
): Promise<CierreInventariosVencidosResult> {
  const horasAbiertas = opts?.horasAbiertas ?? HORAS_ABIERTO_CIERRE_AUTOMATICO_DEFAULT;
  const fechaCierre = opts?.fechaCierreIso ?? medianocheHoyArgentinaIso();
  const candidatos = await listarControlesInventarioParaCierreAutomatico(
    admin,
    horasAbiertas,
    opts?.ahoraMs
  );

  const resultado: CierreInventariosVencidosResult = {
    candidatos: candidatos.length,
    cerrados: 0,
    omitidos: 0,
    errores: [],
    fechaCierre,
    horasAbiertas,
  };

  for (const row of candidatos) {
    const res = await cerrarControlInventario(admin, row.id, {
      fechaCierreIso: fechaCierre,
      consolidarDiferencias: true,
    });

    if (res.ok) {
      resultado.cerrados += 1;
      console.log(
        `[inventario-cierre] Cerrado ${row.id} (sucursal ${row.sucursal_id}, abierto ${row.fecha_inicio})` +
          (res.lineasConDiferencia > 0 ? ` · ${res.lineasConDiferencia} líneas con diferencia` : '')
      );
      continue;
    }

    if (res.code === 'ya_cerrado') {
      resultado.omitidos += 1;
      continue;
    }

    resultado.errores.push({ controlId: row.id, message: res.message });
    console.error(`[inventario-cierre] Error en ${row.id}:`, res.message);
  }

  return resultado;
}
