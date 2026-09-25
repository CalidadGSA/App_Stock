/**
 * Incidencias de inventario: productos que más veces aparecieron con diferencia.
 *
 * El ranking lo resuelve Postgres (migración 032) y acá se lo valoriza con los costos de
 * onze_center, teniendo en cuenta los fraccionados. El histórico de un producto se lee
 * directo del detalle, que ya son pocas filas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rangoFechasArgentinaIso } from '@/lib/utils';
import { getCostosMedicamentosOnze, getUnidadesPorCajaOnze } from '@/lib/legacy-db/onze-medicamentos';
import { valorDiferencia } from '@/lib/inventario/diferencia-valorizada';
import {
  esDiferenciaDeControlAuditoria,
  type FiltroOrigenDiferencias,
} from '@/lib/inventario/diferencias-resumen-carga';

export interface IncidenciaProducto {
  sucursal_id: number;
  sucursal_nombre: string;
  producto_id_sistema: string;
  descripcion: string;
  presentacion: string;
  laboratorio: string;
  /** Líneas con diferencia (una por control donde apareció). */
  veces: number;
  controles: number;
  faltantes: number;
  sobrantes: number;
  /** Diferencia acumulada, real − sistema. Negativo = falta. */
  dif_cajas: number;
  dif_unidades: number;
  /** Diferencia acumulada valorizada a costo, con fraccionados. */
  monto: number;
  primera: string | null;
  ultima: string | null;
}

export interface IncidenciaHistorial {
  control_id: string;
  fecha: string | null;
  sucursal_id: number;
  sucursal_nombre: string;
  tipo: string | null;
  origen: string | null;
  es_auditoria: boolean;
  descripcion_control: string | null;
  sist_cajas: number;
  sist_unidades: number;
  real_cajas: number;
  real_unidades: number;
  dif_cajas: number;
  dif_unidades: number;
  monto: number;
  estado: string | null;
  ajustado: boolean;
}

/** La migración 032 no está aplicada. */
export class FaltaFuncionIncidencias extends Error {}

function faltaLaFuncion(mensaje: string): boolean {
  return /does not exist|could not find the function|schema cache|PGRST202/i.test(mensaje);
}

async function nombresSucursales(admin: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await admin.from('sucursales').select('sucursal, nombrefantasia');
  const out = new Map<number, string>();
  for (const r of (data ?? []) as Array<{ sucursal: number; nombrefantasia: string | null }>) {
    out.set(Number(r.sucursal), String(r.nombrefantasia ?? `Sucursal ${r.sucursal}`));
  }
  return out;
}

export async function cargarIncidencias(
  admin: SupabaseClient,
  params: {
    fechaInicio: string;
    fechaFin: string;
    sucursalId: number | null;
    limite: number;
  }
): Promise<IncidenciaProducto[]> {
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(params.fechaInicio, params.fechaFin);

  const { data, error } = await admin.rpc('admin_incidencias_productos', {
    p_desde: desdeIso,
    p_hasta: hastaIso,
    p_sucursal: params.sucursalId,
    p_limite: params.limite,
  });

  if (error) {
    if (faltaLaFuncion(error.message)) {
      throw new FaltaFuncionIncidencias(
        'Falta aplicar supabase/migrations/032_incidencias_productos.sql en Supabase.'
      );
    }
    throw new Error(error.message);
  }

  type Fila = {
    sucursal_id: number;
    producto_id_sistema: string;
    descripcion: string | null;
    presentacion: string | null;
    laboratorio: string | null;
    veces: number;
    controles: number;
    faltantes: number;
    sobrantes: number;
    dif_cajas: number;
    dif_unidades: number;
    primera: string | null;
    ultima: string | null;
  };

  const filas = (data ?? []) as Fila[];
  if (filas.length === 0) return [];

  const sucursales = await nombresSucursales(admin);

  const porProducto = new Map<string, { cajas: number; unidades: number }>();
  for (const f of filas) {
    const id = String(f.producto_id_sistema);
    const previo = porProducto.get(id) ?? { cajas: 0, unidades: 0 };
    porProducto.set(id, {
      cajas: previo.cajas + Number(f.dif_cajas ?? 0),
      unidades: previo.unidades + Number(f.dif_unidades ?? 0),
    });
  }

  // El costo por producto se pide una sola vez aunque aparezca en varias sucursales.
  const ids = [...porProducto.keys()];
  const [{ costos }, unidadesPorCaja] = await Promise.all([
    getCostosMedicamentosOnze(ids),
    getUnidadesPorCajaOnze(ids),
  ]);

  return filas.map((f) => {
    const id = String(f.producto_id_sistema);
    const difCajas = Number(f.dif_cajas ?? 0);
    const difUnidades = Number(f.dif_unidades ?? 0);
    return {
      sucursal_id: Number(f.sucursal_id),
      sucursal_nombre: sucursales.get(Number(f.sucursal_id)) ?? `Sucursal ${f.sucursal_id}`,
      producto_id_sistema: id,
      descripcion: String(f.descripcion ?? '').trim(),
      presentacion: String(f.presentacion ?? '').trim(),
      laboratorio: String(f.laboratorio ?? '').trim(),
      veces: Number(f.veces ?? 0),
      controles: Number(f.controles ?? 0),
      faltantes: Number(f.faltantes ?? 0),
      sobrantes: Number(f.sobrantes ?? 0),
      dif_cajas: difCajas,
      dif_unidades: difUnidades,
      monto: valorDiferencia(difCajas, difUnidades, unidadesPorCaja.get(id), costos.get(id) ?? 0),
      primera: f.primera ?? null,
      ultima: f.ultima ?? null,
    };
  });
}

/** Cada vez que el producto apareció con diferencia, de la más reciente a la más vieja. */
export async function cargarHistorialIncidencia(
  admin: SupabaseClient,
  params: {
    productoId: string;
    sucursalId: number | null;
    fechaInicio: string;
    fechaFin: string;
    origen?: FiltroOrigenDiferencias;
  }
): Promise<IncidenciaHistorial[]> {
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(params.fechaInicio, params.fechaFin);

  let q = admin
    .from('controles_inventario_detalle')
    .select(
      'control_id, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, estado, ajustado, controles_inventario!inner(id, sucursal_id, estado, fecha_fin, tipo, origen, descripcion)'
    )
    .eq('producto_id_sistema', params.productoId)
    .eq('con_diferencias', 1)
    .eq('controles_inventario.estado', 'cerrado')
    .gte('controles_inventario.fecha_fin', desdeIso)
    .lte('controles_inventario.fecha_fin', hastaIso)
    .limit(500);

  if (params.sucursalId != null) {
    q = q.eq('controles_inventario.sucursal_id', params.sucursalId);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type Control = {
    sucursal_id?: number;
    fecha_fin?: string | null;
    tipo?: string | null;
    origen?: string | null;
    descripcion?: string | null;
  };
  type Fila = {
    control_id: string;
    stock_sist_cajas: number | null;
    stock_sist_unidades: number | null;
    stock_real_cajas: number | null;
    stock_real_unidades: number | null;
    estado: string | null;
    ajustado: number | null;
    controles_inventario?: Control | Control[];
  };

  const filas = (data ?? []) as Fila[];
  const sucursales = await nombresSucursales(admin);

  const [{ costos }, unidadesPorCaja] = await Promise.all([
    getCostosMedicamentosOnze([params.productoId]),
    getUnidadesPorCajaOnze([params.productoId]),
  ]);
  const costo = costos.get(params.productoId) ?? 0;
  const upc = unidadesPorCaja.get(params.productoId);

  const historial: IncidenciaHistorial[] = filas.map((f) => {
    const ctrlRaw = f.controles_inventario;
    const ctrl = (Array.isArray(ctrlRaw) ? ctrlRaw[0] : ctrlRaw) ?? {};
    const sistC = Number(f.stock_sist_cajas ?? 0);
    const sistU = Number(f.stock_sist_unidades ?? 0);
    const realC = Number(f.stock_real_cajas ?? 0);
    const realU = Number(f.stock_real_unidades ?? 0);
    const difC = realC - sistC;
    const difU = realU - sistU;
    const sucId = Number(ctrl.sucursal_id ?? 0);

    return {
      control_id: String(f.control_id),
      fecha: ctrl.fecha_fin ?? null,
      sucursal_id: sucId,
      sucursal_nombre: sucursales.get(sucId) ?? `Sucursal ${sucId}`,
      tipo: ctrl.tipo ?? null,
      origen: ctrl.origen ?? null,
      es_auditoria: esDiferenciaDeControlAuditoria({ origen: ctrl.origen, tipo: ctrl.tipo }),
      descripcion_control: ctrl.descripcion ?? null,
      sist_cajas: sistC,
      sist_unidades: sistU,
      real_cajas: realC,
      real_unidades: realU,
      dif_cajas: difC,
      dif_unidades: difU,
      monto: valorDiferencia(difC, difU, upc, costo),
      estado: f.estado ?? null,
      ajustado: Number(f.ajustado ?? 0) === 1,
    };
  });

  historial.sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));
  return historial;
}
