import type { SupabaseClient } from '@supabase/supabase-js';
import { costosMedicamentosPorCodplex } from '@/lib/inventario/informe-mensual-metricas';
import { rangoMesCalendarioYm } from '@/lib/inventario/informe-mensual-metricas';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import { rangoFechasArgentinaIso } from '@/lib/utils';

export type DiferenciasValorAgregado = {
  /** Suma de diferencias en valor cuando la diferencia en unidades es &gt; 0. */
  valor_positivo: number;
  /** Magnitud de diferencias en valor cuando la diferencia en unidades es &lt; 0. */
  valor_negativo: number;
  /** valor_positivo − valor_negativo (neto). */
  valor_neto: number;
  lineas_con_diferencia: number;
};

const CHUNK = 1000;

function vacio(): DiferenciasValorAgregado {
  return { valor_positivo: 0, valor_negativo: 0, valor_neto: 0, lineas_con_diferencia: 0 };
}

function acumularValor(
  bucket: DiferenciasValorAgregado,
  deltaUnidades: number,
  costo: number
) {
  const valor = deltaUnidades * costo;
  if (!Number.isFinite(valor) || valor === 0) return;
  bucket.lineas_con_diferencia += 1;
  if (valor > 0) {
    bucket.valor_positivo += valor;
  } else {
    bucket.valor_negativo += Math.abs(valor);
  }
  bucket.valor_neto += valor;
}

/** Neto canónico = positivo − negativo (evita desvíos por coma flotante). */
export function normalizarDiferenciasValorAgregado(
  a: DiferenciasValorAgregado
): DiferenciasValorAgregado {
  return {
    ...a,
    valor_neto: a.valor_positivo - a.valor_negativo,
  };
}

export function sumarDiferenciasValor(
  filas: Iterable<DiferenciasValorAgregado>
): DiferenciasValorAgregado {
  const acc = vacio();
  for (const f of filas) {
    acc.valor_positivo += f.valor_positivo;
    acc.valor_negativo += f.valor_negativo;
    acc.lineas_con_diferencia += f.lineas_con_diferencia;
  }
  return normalizarDiferenciasValorAgregado(acc);
}

/**
 * Valor neteado de `controles_inventario_detalle` con `con_diferencias = 1`
 * en controles **cerrados** cuya `fecha_fin` cae en el mes calendario seleccionado
 * (mismo criterio que el KPI de líneas con diferencia del informe mensual).
 *
 * Valor línea = columna `diferencia` (stock_real − stock_sistema) × costo (medicamentos).
 */
export async function cargarDiferenciasValorInventarioPorSucursal(
  admin: SupabaseClient,
  year: number,
  month1_12: number
): Promise<Map<number, DiferenciasValorAgregado>> {
  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month1_12);
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fecha_inicio, fecha_fin);

  const porSucursal = new Map<number, DiferenciasValorAgregado>();
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, diferencia, controles_inventario!inner(sucursal_id, estado, fecha_fin)'
      )
      .eq('controles_inventario.estado', 'cerrado')
      .eq('con_diferencias', 1)
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lte('controles_inventario.fecha_fin', hastaIso)
      .order('id', { ascending: true })
      .range(offset, offset + CHUNK - 1);

    if (error) {
      console.error('cargarDiferenciasValorInventarioPorSucursal:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    const productoIds = batch
      .map((r) => String((r as { producto_id_sistema?: string }).producto_id_sistema ?? '').trim())
      .filter(Boolean);
    const costos = await costosMedicamentosPorCodplex(admin, productoIds);

    for (const row of batch) {
      const r = row as {
        producto_id_sistema?: string;
        diferencia?: number | string | null;
        controles_inventario?: { sucursal_id?: number } | null;
      };
      const sid = Number(r.controles_inventario?.sucursal_id);
      if (!Number.isFinite(sid) || !esSucursalVisibleEnLogin(sid)) continue;

      const delta = Number(r.diferencia ?? 0);
      if (!Number.isFinite(delta) || delta === 0) continue;

      const pid = String(r.producto_id_sistema ?? '').trim();
      const costo = costos.get(pid) ?? 0;

      const prev = porSucursal.get(sid) ?? vacio();
      acumularValor(prev, delta, costo);
      porSucursal.set(sid, prev);
    }

    if (batch.length < CHUNK) break;
    offset += CHUNK;
  }

  return porSucursal;
}

export type DiferenciasValorFilaSucursal = DiferenciasValorAgregado & {
  sucursal_id: number;
  nombrefantasia: string;
};
