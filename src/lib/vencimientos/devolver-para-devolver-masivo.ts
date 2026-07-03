import type { SupabaseClient } from '@supabase/supabase-js';
import { getPadronPorProductos } from '@/lib/padron-final-db';
import {
  cargarIdSubrubroPorProducto,
  cargarMedicamentoMetaPorProducto,
  cargarNombresPsicofarmacos,
  metaMedicamentoPorProducto,
  padronParaProducto,
} from '@/lib/vencimientos-drogueria-lab';
import {
  entraEnListaParaDevolverConMacro,
  macroParaReglaDevolucion,
  rangoFechasVencimientoQuery,
} from '@/lib/vencimientos/para-devolver';
import { fechaHoyArgentinaYmd } from '@/lib/utils';

export type DetalleParaDevolver = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  accion_observacion: string | null;
  categoria_macro: string | null;
  sucursal_id: number;
};

type DetalleRow = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  vendido: number;
  accion_observacion: string | null;
  controles_vencimientos: { sucursal_id: number; categoria_macro?: string | null };
};

async function cargarDetallesCandidatos(
  admin: SupabaseClient,
  sucursalId: number,
  desdeStr: string,
  hastaStr: string
): Promise<DetalleRow[]> {
  const rows: DetalleRow[] = [];
  const chunkSize = 1000;
  let from = 0;

  while (true) {
    const { data: batch, error } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_vencimiento, cantidad, vendido, accion_observacion, controles_vencimientos!inner(sucursal_id, categoria_macro)'
      )
      .eq('controles_vencimientos.sucursal_id', sucursalId)
      .gte('fecha_vencimiento', desdeStr)
      .lte('fecha_vencimiento', hastaStr)
      .eq('devuelto', 0)
      .eq('eliminado', 0)
      .gt('cantidad', 0)
      .order('fecha_vencimiento', { ascending: true })
      .range(from, from + chunkSize - 1);

    if (error) throw new Error(error.message);

    const parsed = (batch ?? []) as unknown as DetalleRow[];
    rows.push(...parsed);
    if (parsed.length < chunkSize) break;
    from += chunkSize;
  }

  return rows;
}

/** Misma elegibilidad que GET /api/vencimientos/para-devolver (sin chequeo venta posterior). */
export async function listarDetallesParaDevolverPorSucursal(
  admin: SupabaseClient,
  sucursalId: number,
  hoyYmd: string = fechaHoyArgentinaYmd()
): Promise<DetalleParaDevolver[]> {
  const { desde: desdeStr, hasta: hastaStr } = rangoFechasVencimientoQuery(hoyYmd);
  const rows = await cargarDetallesCandidatos(admin, sucursalId, desdeStr, hastaStr);

  const productoIds = Array.from(
    new Set(rows.map((r) => String(r.producto_id_sistema ?? '').trim()).filter(Boolean))
  );

  const padronPorProducto = new Map<
    string,
    { cat_macro: string | null; categoria: string | null; subrubro: string | null }
  >();
  const chunkSize = 800;
  for (let i = 0; i < productoIds.length; i += chunkSize) {
    const lote = productoIds.slice(i, i + chunkSize);
    const padronLote = await getPadronPorProductos(lote);
    for (const [k, v] of padronLote) {
      const key = String(k).trim();
      if (!key) continue;
      padronPorProducto.set(key, v);
      const num = Number(key);
      if (Number.isFinite(num)) padronPorProducto.set(String(num), v);
    }
  }

  let idSubrubroPorProducto = new Map<string, number | null>();
  try {
    idSubrubroPorProducto = await cargarIdSubrubroPorProducto(admin, productoIds);
  } catch {
    idSubrubroPorProducto = new Map();
  }

  let medicamentoMetaPorProducto = new Map<
    string,
    { codlab: number | null; idpsicofarmaco: string | null }
  >();
  let nombrePsicoPorId = new Map<string, string>();
  try {
    medicamentoMetaPorProducto = await cargarMedicamentoMetaPorProducto(admin, productoIds);
  } catch {
    medicamentoMetaPorProducto = new Map();
  }
  try {
    nombrePsicoPorId = await cargarNombresPsicofarmacos(admin);
  } catch {
    nombrePsicoPorId = new Map();
  }

  const elegibles: DetalleParaDevolver[] = [];

  for (const r of rows) {
    if (Number(r.vendido ?? 0) === 1) continue;

    const pid = String(r.producto_id_sistema ?? '').trim();
    const padron = padronParaProducto(padronPorProducto, pid);
    const meta = metaMedicamentoPorProducto(medicamentoMetaPorProducto, pid);
    const idsubrubro =
      idSubrubroPorProducto.get(pid) ??
      (Number.isFinite(Number(pid)) ? idSubrubroPorProducto.get(String(Number(pid))) : undefined) ??
      null;
    const cat = macroParaReglaDevolucion(
      padron,
      meta,
      nombrePsicoPorId,
      idsubrubro,
      r.controles_vencimientos?.categoria_macro ?? null
    );
    const fechaVencStr = String(r.fecha_vencimiento ?? '').trim().slice(0, 10);
    if (!entraEnListaParaDevolverConMacro(cat, fechaVencStr, hoyYmd)) continue;

    elegibles.push({
      id: r.id,
      control_id: r.control_id,
      producto_id_sistema: pid,
      codigo_barras: String(r.codigo_barras ?? ''),
      descripcion: r.descripcion,
      presentacion: r.presentacion ?? null,
      laboratorio: r.laboratorio ?? null,
      fecha_vencimiento: fechaVencStr,
      cantidad: Number(r.cantidad ?? 0),
      accion_observacion:
        r.accion_observacion != null && String(r.accion_observacion).trim() !== ''
          ? String(r.accion_observacion)
          : null,
      categoria_macro: cat,
      sucursal_id: Number(r.controles_vencimientos?.sucursal_id),
    });
  }

  return elegibles;
}

/** Cantidad de líneas elegibles en «para devolver» (misma lógica que GET /api/vencimientos/para-devolver). */
export async function contarProductosParaDevolver(
  admin: SupabaseClient,
  sucursalId: number,
  hoyYmd: string = fechaHoyArgentinaYmd()
): Promise<number> {
  const items = await listarDetallesParaDevolverPorSucursal(admin, sucursalId, hoyYmd);
  return items.length;
}

export async function registrarDevolucionMasiva(
  admin: SupabaseClient,
  sucursalId: number,
  usuarioId: number,
  detalles: DetalleParaDevolver[]
): Promise<{ devolucion_id: string; cantidad: number }> {
  if (detalles.length === 0) {
    throw new Error('No hay detalles para devolver');
  }

  for (const d of detalles) {
    if (d.sucursal_id !== sucursalId) {
      throw new Error(`Detalle ${d.id} no pertenece a la sucursal ${sucursalId}`);
    }
  }

  const { data: cab, error: cabError } = await admin
    .from('devoluciones_vencimientos')
    .insert({
      sucursal_id: sucursalId,
      usuario_id: usuarioId,
    })
    .select()
    .single();

  if (cabError || !cab) {
    throw new Error(cabError?.message ?? 'Error al registrar la devolución');
  }

  const devolucionId = cab.id as string;
  const ids = detalles.map((d) => d.id);

  const detalleRows = detalles.map((d) => ({
    devolucion_id: devolucionId,
    detalle_vencimiento_id: d.id,
    control_id: d.control_id,
    producto_id_sistema: d.producto_id_sistema,
    codigo_barras: d.codigo_barras,
    descripcion: d.descripcion,
    presentacion: d.presentacion,
    laboratorio: d.laboratorio,
    fecha_vencimiento: d.fecha_vencimiento,
    cantidad: d.cantidad,
    categoria_macro: d.categoria_macro,
    accion_observacion: d.accion_observacion,
  }));

  const { error: detInsError } = await admin.from('devoluciones_vencimientos_detalle').insert(detalleRows);
  if (detInsError) throw new Error(detInsError.message);

  const { error: updError } = await admin
    .from('controles_vencimientos_detalle')
    .update({ vendido: 0, devuelto: 1 })
    .in('id', ids);

  if (updError) throw new Error(updError.message);

  return { devolucion_id: devolucionId, cantidad: detalles.length };
}

export type ResumenDevolucionMasivaSucursal = {
  sucursal_id: number;
  nombre: string;
  elegibles: number;
  devolucion_id?: string;
  error?: string;
};

export type ResultadoDevolucionMasiva = {
  hoy: string;
  dry_run: boolean;
  usuario_id: number;
  total_elegibles: number;
  total_devueltos: number;
  sucursales: ResumenDevolucionMasivaSucursal[];
};

async function resolverUsuarioId(admin: SupabaseClient): Promise<number> {
  const fromEnv = String(process.env.DEVOLUCION_MASIVA_USUARIO_ID ?? '').trim();
  if (fromEnv) {
    const id = parseInt(fromEnv, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error('DEVOLUCION_MASIVA_USUARIO_ID inválido');
    }
    return id;
  }

  const { data, error } = await admin
    .from('operadores')
    .select('idoperador')
    .eq('rol', 'superadmin')
    .order('idoperador', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const id = Number((data as { idoperador?: number } | null)?.idoperador);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(
      'Definí DEVOLUCION_MASIVA_USUARIO_ID o asegurate de tener un operador superadmin'
    );
  }
  return id;
}

/**
 * Marca como devueltos los productos elegibles de «para devolver» en todas las sucursales.
 * Replica PATCH ?devolver_todos=1 sucursal por sucursal.
 */
export async function ejecutarDevolucionMasivaTodasSucursales(
  admin: SupabaseClient,
  opts?: { dryRun?: boolean; hoyYmd?: string; sucursalIds?: number[] }
): Promise<ResultadoDevolucionMasiva> {
  const dryRun = opts?.dryRun !== false;
  const hoy = opts?.hoyYmd ?? fechaHoyArgentinaYmd();
  const usuarioId = dryRun ? 0 : await resolverUsuarioId(admin);

  const { data: sucRows, error: sucError } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .order('sucursal', { ascending: true });

  if (sucError) throw new Error(sucError.message);

  const filtro = opts?.sucursalIds?.length
    ? new Set(opts.sucursalIds.map((x) => Number(x)))
    : null;

  const sucursales = (sucRows ?? []).filter((s) => {
    const id = Number((s as { sucursal: number }).sucursal);
    return filtro ? filtro.has(id) : true;
  }) as Array<{ sucursal: number; nombrefantasia: string | null }>;

  const resumen: ResumenDevolucionMasivaSucursal[] = [];
  let totalElegibles = 0;
  let totalDevueltos = 0;

  for (const suc of sucursales) {
    const sucursalId = Number(suc.sucursal);
    const nombre = String(suc.nombrefantasia ?? `Sucursal ${sucursalId}`);

    try {
      const elegibles = await listarDetallesParaDevolverPorSucursal(admin, sucursalId, hoy);
      totalElegibles += elegibles.length;

      if (elegibles.length === 0) {
        resumen.push({ sucursal_id: sucursalId, nombre, elegibles: 0 });
        continue;
      }

      if (dryRun) {
        resumen.push({ sucursal_id: sucursalId, nombre, elegibles: elegibles.length });
        continue;
      }

      const { devolucion_id, cantidad } = await registrarDevolucionMasiva(
        admin,
        sucursalId,
        usuarioId,
        elegibles
      );
      totalDevueltos += cantidad;
      resumen.push({
        sucursal_id: sucursalId,
        nombre,
        elegibles: cantidad,
        devolucion_id,
      });
    } catch (e) {
      resumen.push({
        sucursal_id: sucursalId,
        nombre,
        elegibles: 0,
        error: (e as Error).message,
      });
    }
  }

  return {
    hoy,
    dry_run: dryRun,
    usuario_id: usuarioId,
    total_elegibles: totalElegibles,
    total_devueltos: totalDevueltos,
    sucursales: resumen,
  };
}
