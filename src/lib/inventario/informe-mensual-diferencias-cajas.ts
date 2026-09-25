import type { SupabaseClient } from '@supabase/supabase-js';
import {
  costosMedicamentosPorCodplex,
  rangoMesCalendarioYm,
} from '@/lib/inventario/informe-mensual-metricas';
import {
  normalizarDiferenciasValorAgregado,
  type DiferenciasValorAgregado,
} from '@/lib/inventario/informe-mensual-diferencias-valor';
import { cajasEquivalentes, valorDiferencia } from '@/lib/inventario/diferencia-valorizada';
import {
  cargarControlesCerradosDelMes,
  recorrerDetallesConDiferencia,
} from '@/lib/inventario/detalle-diferencias-mes';
import { getUnidadesPorCajaOnze } from '@/lib/legacy-db/onze-medicamentos';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import { rangoFechasArgentinaIso } from '@/lib/utils';

const CHUNK = 1000;

export type SignoDiferenciaCajas = 'todas' | 'positiva' | 'negativa';

export type DiferenciaCajasValorFila = {
  detalle_id: string;
  control_id: string;
  sucursal_id: number;
  sucursal_nombre: string;
  producto_id_sistema: string;
  codigo_barras: string | null;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  diff_cajas: number;
  costo_caja: number;
  valor_diferencia: number;
  fecha_fin_control: string | null;
  tipo_control: string | null;
};

export type DiferenciaCajasValorTotales = {
  lineas: number;
  diff_cajas: number;
  valor_positivo: number;
  valor_negativo: number;
  valor_neto: number;
};

function vacioTotales(): DiferenciaCajasValorTotales {
  return { lineas: 0, diff_cajas: 0, valor_positivo: 0, valor_negativo: 0, valor_neto: 0 };
}

function vacioAgregado(): DiferenciasValorAgregado {
  return { lineas_con_diferencia: 0, valor_positivo: 0, valor_negativo: 0, valor_neto: 0 };
}

function acumularAgregado(bucket: DiferenciasValorAgregado, valor: number) {
  if (!Number.isFinite(valor) || valor === 0) return;
  bucket.lineas_con_diferencia += 1;
  if (valor > 0) bucket.valor_positivo += valor;
  else bucket.valor_negativo += Math.abs(valor);
}

function cerrarAgregado(bucket: DiferenciasValorAgregado): DiferenciasValorAgregado {
  return normalizarDiferenciasValorAgregado(bucket);
}

function acumularTotales(t: DiferenciaCajasValorTotales, diffCajas: number, valor: number) {
  if (!Number.isFinite(valor) || valor === 0) return;
  t.lineas += 1;
  t.diff_cajas += diffCajas;
  if (valor > 0) t.valor_positivo += valor;
  else t.valor_negativo += Math.abs(valor);
}

function cerrarTotales(t: DiferenciaCajasValorTotales): DiferenciaCajasValorTotales {
  return { ...t, valor_neto: t.valor_positivo - t.valor_negativo };
}

function pasaFiltroSigno(diffTotal: number, signo: SignoDiferenciaCajas): boolean {
  if (signo === 'positiva') return diffTotal > 0;
  if (signo === 'negativa') return diffTotal < 0;
  return true;
}

/**
 * Líneas de `controles_inventario_detalle` con diferencia de stock.
 *
 * `diff_cajas` son las cajas enteras; el **valor** además suma las unidades sueltas como
 * fracción de caja (`medicamentos.Unidades`), para que los fraccionados no queden sin valorizar.
 */
export async function cargarDetalleDiferenciasCajasValor(
  admin: SupabaseClient,
  year: number,
  month1_12: number,
  opts?: { sucursalId?: number | null; signo?: SignoDiferenciaCajas }
): Promise<{ filas: DiferenciaCajasValorFila[]; totales: DiferenciaCajasValorTotales }> {
  const signo = opts?.signo ?? 'todas';
  const sucursalId =
    opts?.sucursalId != null && Number.isFinite(opts.sucursalId) ? opts.sucursalId : null;

  const { fecha_inicio, fecha_fin } = rangoMesCalendarioYm(year, month1_12);
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fecha_inicio, fecha_fin);

  const filas: DiferenciaCajasValorFila[] = [];
  const totales = vacioTotales();
  let offset = 0;

  while (true) {
    let q = admin
      .from('controles_inventario_detalle')
      .select(
        `id,
        producto_id_sistema,
        codigo_barras,
        descripcion,
        presentacion,
        laboratorio,
        stock_sist_cajas,
        stock_sist_unidades,
        stock_real_cajas,
        stock_real_unidades,
        controles_inventario!inner(
          id,
          sucursal_id,
          tipo,
          estado,
          fecha_fin,
          sucursales(nombrefantasia)
        )`
      )
      .eq('controles_inventario.estado', 'cerrado')
      .eq('con_diferencias', 1)
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lte('controles_inventario.fecha_fin', hastaIso)
      .order('id', { ascending: true })
      .range(offset, offset + CHUNK - 1);

    if (sucursalId != null) {
      q = q.eq('controles_inventario.sucursal_id', sucursalId);
    }

    const { data, error } = await q;

    if (error) {
      console.error('cargarDetalleDiferenciasCajasValor:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    const productoIds = batch
      .map((r) => String((r as { producto_id_sistema?: string }).producto_id_sistema ?? '').trim())
      .filter(Boolean);
    const [costos, unidadesPorCaja] = await Promise.all([
      costosMedicamentosPorCodplex(admin, productoIds),
      getUnidadesPorCajaOnze(productoIds),
    ]);

    for (const row of batch) {
      const r = row as {
        id?: string;
        producto_id_sistema?: string;
        codigo_barras?: string | null;
        descripcion?: string | null;
        presentacion?: string | null;
        laboratorio?: string | null;
        stock_sist_cajas?: number | string | null;
        stock_sist_unidades?: number | string | null;
        stock_real_cajas?: number | string | null;
        stock_real_unidades?: number | string | null;
        controles_inventario?: {
          id?: string;
          sucursal_id?: number;
          tipo?: string | null;
          fecha_fin?: string | null;
          sucursales?: { nombrefantasia?: string | null } | null;
        } | null;
      };

      const sid = Number(r.controles_inventario?.sucursal_id);
      if (!Number.isFinite(sid) || !esSucursalVisibleEnLogin(sid)) continue;

      const diffCajas = Number(r.stock_real_cajas ?? 0) - Number(r.stock_sist_cajas ?? 0);
      const diffUnidades =
        Number(r.stock_real_unidades ?? 0) - Number(r.stock_sist_unidades ?? 0);
      if (!Number.isFinite(diffCajas) || !Number.isFinite(diffUnidades)) continue;
      if (diffCajas === 0 && diffUnidades === 0) continue;

      const pid = String(r.producto_id_sistema ?? '').trim();
      const upc = unidadesPorCaja.get(pid);
      if (!pasaFiltroSigno(cajasEquivalentes(diffCajas, diffUnidades, upc), signo)) continue;

      const costo = costos.get(pid) ?? 0;
      const valor = valorDiferencia(diffCajas, diffUnidades, upc, costo);

      acumularTotales(totales, diffCajas, valor);

      filas.push({
        detalle_id: String(r.id ?? ''),
        control_id: String(r.controles_inventario?.id ?? ''),
        sucursal_id: sid,
        sucursal_nombre:
          String(r.controles_inventario?.sucursales?.nombrefantasia ?? '').trim() ||
          `Sucursal ${sid}`,
        producto_id_sistema: pid,
        codigo_barras: r.codigo_barras ?? null,
        descripcion: String(r.descripcion ?? '').trim() || pid,
        presentacion: r.presentacion ?? null,
        laboratorio: r.laboratorio ?? null,
        diff_cajas: diffCajas,
        costo_caja: costo,
        valor_diferencia: valor,
        fecha_fin_control: r.controles_inventario?.fecha_fin ?? null,
        tipo_control: r.controles_inventario?.tipo ?? null,
      });
    }

    if (batch.length < CHUNK) break;
    offset += CHUNK;
  }

  filas.sort(
    (a, b) =>
      Math.abs(b.valor_diferencia) - Math.abs(a.valor_diferencia) ||
      a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es', { sensitivity: 'base' }) ||
      a.descripcion.localeCompare(b.descripcion, 'es', { sensitivity: 'base' })
  );

  return { filas, totales: cerrarTotales(totales) };
}

/**
 * Mismo criterio que {@link cargarDetalleDiferenciasCajasValor}, agregado por sucursal
 * (para gráficos y KPI del informe mensual).
 */
export async function cargarDiferenciasCajasValorPorSucursal(
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

        const prev = porSucursal.get(sid) ?? vacioAgregado();
        acumularAgregado(prev, valor);
        porSucursal.set(sid, prev);
      }
    },
    'cargarDiferenciasCajasValorPorSucursal'
  );

  // Neto canónico = positivo − negativo.
  for (const [sid, agg] of porSucursal) {
    porSucursal.set(sid, cerrarAgregado(agg));
  }

  return porSucursal;
}
