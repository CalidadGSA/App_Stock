import type { SupabaseClient } from '@supabase/supabase-js';
import { getPadronPorProductos } from '@/lib/padron-final-db';
import { rangoFechasArgentinaIso, ymdDesdeIsoArgentina } from '@/lib/utils';

export interface DiferenciaResumenFila {
  detalle_id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  diffCajas: number;
  diffUnidades: number;
  operador: string;
  fecha_control: string;
  control_tipo: string | null;
  control_descripcion: string | null;
  control_origen: string | null;
  cat_macro: string | null;
  sucursal_id?: number;
  sucursal_nombre?: string | null;
}

export type FiltroOrigenDiferenciasResumen = 'sucursal' | 'auditoria';
export type FiltroOrigenDiferencias = 'sucursal' | 'auditoria' | 'todos';

const TIPOS_CONTROL_AUDITORIA = new Set([
  'auditoria',
  'ocasional_auditoria',
  'auditoria_integral',
  'auditoria_sorpresa',
]);

type ControlMinimo = { origen?: string | null; tipo?: string | null };

/** Diferencias generadas en controles de auditoría (no cuentan en resumen de sucursal). */
export function esDiferenciaDeControlAuditoria(control: ControlMinimo | null | undefined): boolean {
  if (!control) return false;
  const origen = String(control.origen ?? '').trim();
  if (origen === 'Auditoria') return true;
  const tipo = String(control.tipo ?? '').trim().toLowerCase();
  return TIPOS_CONTROL_AUDITORIA.has(tipo);
}

function pasaFiltroOrigen(
  control: ControlMinimo | null | undefined,
  filtro: FiltroOrigenDiferencias
): boolean {
  if (filtro === 'todos') return true;
  const esAud = esDiferenciaDeControlAuditoria(control);
  return filtro === 'auditoria' ? esAud : !esAud;
}

function pasaFiltroMesAnioControl(ymdControl: string, mes?: number, anio?: number): boolean {
  if (!mes && !anio) return true;
  if (!ymdControl || ymdControl.length < 7) return false;
  const [y, m] = ymdControl.split('-').map((n) => parseInt(n, 10));
  if (anio != null && Number.isFinite(anio) && y !== anio) return false;
  if (mes != null && Number.isFinite(mes) && m !== mes) return false;
  return true;
}

export type CargarDiferenciasResumenOpts = {
  consolidado?: boolean;
  sucursalId?: number;
  sucursalFiltro?: number;
  desde: string;
  hasta: string;
  filtroOrigen: FiltroOrigenDiferencias;
  tipoControl?: string;
  busqueda?: string;
  categoriaMacro?: string;
  mesControl?: number;
  anioControl?: number;
  operador?: string;
  /** Orden por fecha del control (defecto: más recientes primero). */
  ordenFecha?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  unpaginated?: boolean;
};

export type CargarDiferenciasResumenResult = {
  data: DiferenciaResumenFila[];
  total: number;
  page: number;
  pageSize: number;
  cat_macros: string[];
  operadores: string[];
};

export async function cargarDiferenciasResumenPeriodo(
  admin: SupabaseClient,
  opts: CargarDiferenciasResumenOpts
): Promise<CargarDiferenciasResumenResult> {
  const {
    consolidado = false,
    sucursalId,
    sucursalFiltro,
    desde,
    hasta,
    filtroOrigen,
    tipoControl = '',
    busqueda,
    categoriaMacro,
    mesControl,
    anioControl,
    operador = '',
    ordenFecha = 'desc',
    page = 1,
    pageSize = 20,
    unpaginated = false,
  } = opts;

  if (!consolidado && (sucursalId == null || Number.isNaN(sucursalId))) {
    throw new Error('Sucursal requerida');
  }

  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(desde, hasta);

  const selectSucursal = consolidado
    ? 'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_registro, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, controles_inventario!inner(id, fecha_inicio, fecha_fin, sucursal_id, estado, origen, tipo, descripcion, usuario_id, operadores(nombrecompleto), sucursales(nombrefantasia))'
    : 'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, fecha_registro, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, controles_inventario!inner(id, fecha_inicio, fecha_fin, sucursal_id, estado, origen, tipo, descripcion, usuario_id, operadores(nombrecompleto))';

  const tipoDb = String(tipoControl ?? '').trim();
  const termBusqueda = busqueda?.trim() ?? '';

  const buildQuery = () => {
    let q = admin
      .from('controles_inventario_detalle')
      .select(selectSucursal)
      .eq('controles_inventario.estado', 'cerrado')
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lte('controles_inventario.fecha_fin', hastaIso)
      .eq('con_diferencias', 1);

    if (consolidado) {
      if (sucursalFiltro != null && sucursalFiltro > 0) {
        q = q.eq('controles_inventario.sucursal_id', sucursalFiltro);
      }
    } else {
      q = q.eq('controles_inventario.sucursal_id', sucursalId!);
    }
    if (tipoDb) q = q.eq('controles_inventario.tipo', tipoDb);
    if (termBusqueda) {
      const term = termBusqueda.replace(/[%_\\]/g, (c) => `\\${c}`);
      const like = `%${term}%`;
      q = q.or(
        `codigo_barras.ilike.${like},descripcion.ilike.${like},presentacion.ilike.${like},laboratorio.ilike.${like},producto_id_sistema.ilike.${like}`
      );
    }
    return q;
  };

  const acumulado: unknown[] = [];
  const chunkSize = 1000;
  let chunkOffset = 0;
  while (true) {
    const { data, error } = await buildQuery()
      .order('fecha_registro', { ascending: false })
      .range(chunkOffset, chunkOffset + chunkSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    acumulado.push(...batch);
    if (batch.length < chunkSize) break;
    chunkOffset += chunkSize;
  }
  const rawRows = acumulado;

  type Row = {
    id: string;
    control_id?: string | null;
    producto_id_sistema: string;
    codigo_barras: string;
    descripcion: string;
    presentacion: string | null;
    laboratorio: string | null;
    stock_sist_cajas?: number | null;
    stock_sist_unidades?: number | null;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
    fecha_registro?: string | null;
  };

  const filas: DiferenciaResumenFila[] = [];

  for (const d of ((rawRows as Row[]) ?? [])) {
    const sistC = d.stock_sist_cajas ?? 0;
    const sistU = d.stock_sist_unidades ?? 0;
    const realC = d.stock_real_cajas ?? 0;
    const realU = d.stock_real_unidades ?? 0;
    const deltaC = realC - sistC;
    const deltaU = realU - sistU;
    if (deltaC === 0 && deltaU === 0) continue;

    const controlRaw = (d as { controles_inventario?: unknown }).controles_inventario;
    const control = (Array.isArray(controlRaw) ? controlRaw[0] : controlRaw) as
      | {
          id?: string | null;
          fecha_inicio?: string | null;
          fecha_fin?: string | null;
          sucursal_id?: number | null;
          origen?: string | null;
          tipo?: string | null;
          descripcion?: string | null;
          operadores?: { nombrecompleto?: string | null } | null;
          usuario_id?: number | null;
          sucursales?: { nombrefantasia?: string | null } | null;
        }
      | null
      | undefined;

    if (!pasaFiltroOrigen(control, filtroOrigen)) continue;

    const fechaControl = String(
      d.fecha_registro ?? control?.fecha_fin ?? control?.fecha_inicio ?? ''
    ).trim();
    const ymdControl = ymdDesdeIsoArgentina(fechaControl);
    if (!ymdControl || ymdControl < desde || ymdControl > hasta) continue;
    if (!pasaFiltroMesAnioControl(ymdControl, mesControl, anioControl)) continue;

    const controlId = String(d.control_id ?? control?.id ?? '').trim();
    if (!controlId) continue;

    const opNombre = String(control?.operadores?.nombrecompleto ?? '').trim();
    const operador =
      opNombre || (control?.usuario_id != null ? `Operador ${control.usuario_id}` : '—');

    const sid = Number(control?.sucursal_id ?? 0);
    const sn = consolidado
      ? String(control?.sucursales?.nombrefantasia ?? '').trim() || (sid ? `Sucursal ${sid}` : '')
      : undefined;

    filas.push({
      detalle_id: String(d.id),
      control_id: controlId,
      producto_id_sistema: d.producto_id_sistema,
      codigo_barras: d.codigo_barras,
      descripcion: d.descripcion,
      presentacion: d.presentacion ?? null,
      laboratorio: d.laboratorio ?? null,
      diffCajas: deltaC,
      diffUnidades: deltaU,
      operador,
      fecha_control: fechaControl,
      control_tipo: control?.tipo != null ? String(control.tipo) : null,
      control_descripcion: control?.descripcion != null ? String(control.descripcion) : null,
      control_origen: control?.origen != null ? String(control.origen) : null,
      cat_macro: null,
      sucursal_id: sid || undefined,
      sucursal_nombre: sn,
    });
  }

  filas.sort((a, b) => {
    const fc =
      ordenFecha === 'asc'
        ? a.fecha_control.localeCompare(b.fecha_control)
        : b.fecha_control.localeCompare(a.fecha_control);
    if (fc !== 0) return fc;
    return a.descripcion.localeCompare(b.descripcion, 'es');
  });

  const padron = await getPadronPorProductos(
    Array.from(new Set(filas.map((x) => x.producto_id_sistema)))
  );

  const conMacro = filas.map((f) => ({
    ...f,
    cat_macro: padron.get(String(f.producto_id_sistema))?.cat_macro ?? null,
  }));

  const filtradasMacro = categoriaMacro
    ? conMacro.filter(
        (r) => String(r.cat_macro ?? '').toUpperCase() === String(categoriaMacro).toUpperCase()
      )
    : conMacro;

  const cat_macros = Array.from(
    new Set(
      conMacro
        .map((r) => String(r.cat_macro ?? '').trim())
        .filter((v) => v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const operadores = Array.from(
    new Set(
      filtradasMacro
        .map((r) => String(r.operador ?? '').trim())
        .filter((op) => op && op !== '—')
    )
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const operadorFiltro = operador.trim();
  const filtradasOperador = operadorFiltro
    ? filtradasMacro.filter((r) => String(r.operador ?? '').trim() === operadorFiltro)
    : filtradasMacro;

  const total = filtradasOperador.length;
  const pageSafe = Math.max(1, page);
  const sizeSafe = unpaginated
    ? Math.min(10_000, Math.max(5, pageSize))
    : Math.min(500, Math.max(5, pageSize));
  const pageOffset = unpaginated ? 0 : (pageSafe - 1) * sizeSafe;
  const pageData = filtradasOperador.slice(pageOffset, pageOffset + sizeSafe);

  return {
    data: pageData,
    total,
    page: unpaginated ? 1 : pageSafe,
    pageSize: sizeSafe,
    cat_macros,
    operadores,
  };
}
