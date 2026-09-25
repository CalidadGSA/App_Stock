import type { SupabaseClient } from '@supabase/supabase-js';
import { costosMedicamentosPorCodplex } from '@/lib/inventario/informe-mensual-metricas';
import {
  cargarControlesCerradosDelMes,
  recorrerDetallesConDiferencia,
} from '@/lib/inventario/detalle-diferencias-mes';
import { valorDiferencia } from '@/lib/inventario/diferencia-valorizada';
import { getUnidadesPorCajaOnze } from '@/lib/legacy-db/onze-medicamentos';

export type DiferenciasValorAgregado = {
  /** Suma de diferencias en valor cuando la diferencia en unidades es &gt; 0. */
  valor_positivo: number;
  /** Magnitud de diferencias en valor cuando la diferencia en unidades es &lt; 0. */
  valor_negativo: number;
  /** valor_positivo − valor_negativo (neto). */
  valor_neto: number;
  lineas_con_diferencia: number;
};

function vacio(): DiferenciasValorAgregado {
  return { valor_positivo: 0, valor_negativo: 0, valor_neto: 0, lineas_con_diferencia: 0 };
}

function acumularValor(bucket: DiferenciasValorAgregado, valor: number) {
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
 * Valor línea = (diferencia en cajas + diferencia en unidades / unidades por caja) × costo.
 * Las unidades sueltas se convierten a cajas con `medicamentos.Unidades` para no valorizar
 * un comprimido como si fuera una caja entera.
 */
export async function cargarDiferenciasValorInventarioPorSucursal(
  admin: SupabaseClient,
  year: number,
  month1_12: number
): Promise<Map<number, DiferenciasValorAgregado>> {
  const porSucursal = new Map<number, DiferenciasValorAgregado>();

  const controles = await cargarControlesCerradosDelMes(admin, year, month1_12);
  if (controles.length === 0) return porSucursal;
  const sucursalPorControl = new Map(controles.map((c) => [c.id, c.sucursal_id]));

  type Fila = {
    control_id: string;
    producto_id_sistema?: string;
    stock_sist_cajas?: number | string | null;
    stock_sist_unidades?: number | string | null;
    stock_real_cajas?: number | string | null;
    stock_real_unidades?: number | string | null;
  };

  await recorrerDetallesConDiferencia<Fila>(
    admin,
    controles.map((c) => c.id),
    'control_id, producto_id_sistema, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades',
    async (batch) => {
      const productoIds = batch
        .map((r) => String(r.producto_id_sistema ?? '').trim())
        .filter(Boolean);
      const [costos, unidadesPorCaja] = await Promise.all([
        costosMedicamentosPorCodplex(admin, productoIds),
        getUnidadesPorCajaOnze(productoIds),
      ]);

      for (const r of batch) {
        const sid = sucursalPorControl.get(r.control_id);
        if (sid == null) continue;

        const diffCajas = Number(r.stock_real_cajas ?? 0) - Number(r.stock_sist_cajas ?? 0);
        const diffUnidades =
          Number(r.stock_real_unidades ?? 0) - Number(r.stock_sist_unidades ?? 0);
        if (diffCajas === 0 && diffUnidades === 0) continue;

        const pid = String(r.producto_id_sistema ?? '').trim();
        const valor = valorDiferencia(
          diffCajas,
          diffUnidades,
          unidadesPorCaja.get(pid),
          costos.get(pid) ?? 0
        );

        const prev = porSucursal.get(sid) ?? vacio();
        acumularValor(prev, valor);
        porSucursal.set(sid, prev);
      }
    },
    'cargarDiferenciasValorInventarioPorSucursal'
  );

  return porSucursal;
}

export type DiferenciasValorFilaSucursal = DiferenciasValorAgregado & {
  sucursal_id: number;
  nombrefantasia: string;
};
