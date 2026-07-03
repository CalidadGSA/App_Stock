import type { SupabaseClient } from '@supabase/supabase-js';
import { orFiltroMacrosPadronTrimestre } from '@/lib/inventario/categoria-macro';
import { esDiferenciaDeControlAuditoria } from '@/lib/inventario/diferencias-resumen-carga';
import { ymdAddDays, rangoFechasArgentinaIso } from '@/lib/utils';
import { rangoIsoRegistroTrimestre } from '@/lib/inventario/trimestre-periodo';
import { sumarCantidadVendidaPorDetalle } from '@/lib/vencimientos-detalle-ventas';

/** Igual que el listado de vencidos: fecha de vencimiento cae dentro de estos días antes de hoy. */
export const VENCIDOS_VENTANA_DIAS_ATRAS = 40;

function menorYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export interface VentanasPorVencerTrimestre {
  total_trimestre: number;
  /** Vence entre hoy y el menor de (fin de trimestre, hoy+30). */
  por_vencer_primeros_30: number;
  /** Vence entre hoy+31 y el menor de (fin de trimestre, hoy+60). */
  por_vencer_31_a_60: number;
  /** Vence entre hoy+61 y el menor de (fin de trimestre, hoy+90). */
  por_vencer_61_a_90: number;
}

export interface ProgresoTrimestreMacro {
  macro: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS';
  total: number;
  inventariados: number;
  pendientes: number;
  porcentaje: number;
}

export interface ProgresoTrimestreSucursal {
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  inventariados: number;
  pendientes: number;
  porcentaje: number;
  por_macro?: ProgresoTrimestreMacro[];
}

const COLUMN_VARIANTS = [
  {
    id: 'idsucursal',
    ini: 'fechainicio',
    fin: 'fechafin',
    veces: 'vecesinventariado',
    trim: 'trimestre',
  },
  {
    id: 'idSucursal',
    ini: 'fechaInicio',
    fin: 'fechaFin',
    veces: 'vecesInventariado',
    trim: 'trimestre',
  },
] as const;

const MACROS_TRIMESTRE = ['FARMA', 'BIENESTAR', 'PSICOTROPICOS'] as const;
/** Columna real en PostgreSQL (schema.sql). */
const CAMPO_MACRO_BASE_PRODUCTOS = 'categoriamacro';

function totalesDesdeProgresoPorMacro(porMacro: ProgresoTrimestreMacro[]): {
  total: number;
  inventariados: number;
  pendientes: number;
  porcentaje: number;
} {
  const total = porMacro.reduce((s, m) => s + m.total, 0);
  const inventariados = porMacro.reduce((s, m) => s + m.inventariados, 0);
  const pendientes = Math.max(0, total - inventariados);
  const porcentaje = total > 0 ? Math.round((inventariados / total) * 100) : 0;
  return { total, inventariados, pendientes, porcentaje };
}

/** El trimestre de padrón está completo (habilita inventario «Sin padron»). */
export function trimestrePadronCompleto(
  progreso: Pick<ProgresoTrimestreSucursal, 'total' | 'pendientes'>
): boolean {
  if (progreso.total <= 0) return true;
  return progreso.pendientes <= 0;
}

/** Conteo en base_productos solo para macros de padrón trimestral (sin «Sin padron»). */
async function contarBaseProductosProgresoPadron(
  admin: SupabaseClient,
  v: (typeof COLUMN_VARIANTS)[number],
  sucId: number,
  trimestreDb: string,
  opts?: { soloInventariados?: boolean }
): Promise<number | null> {
  const macroField = CAMPO_MACRO_BASE_PRODUCTOS;
  let q = admin
    .from('base_productos')
    .select('*', { count: 'exact', head: true })
    .eq(v.id, sucId)
    .eq(v.trim, trimestreDb)
    .or(orFiltroMacrosPadronTrimestre(macroField));

  if (opts?.soloInventariados) {
    q = q.gt(v.veces, 0);
  }

  const { count, error } = await q;
  if (error) {
    console.error('contarBaseProductosProgresoPadron:', error.message);
    return null;
  }
  return count ?? 0;
}

async function obtenerProgresoPorMacroTrimestre(
  admin: SupabaseClient,
  v: (typeof COLUMN_VARIANTS)[number],
  sucId: number,
  trimestreDb: string
): Promise<ProgresoTrimestreMacro[]> {
  const macroField = CAMPO_MACRO_BASE_PRODUCTOS;
  const porMacro: ProgresoTrimestreMacro[] = [];

  for (const macro of MACROS_TRIMESTRE) {
    const { count: total, error: errTotal } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq(v.id, sucId)
      .eq(v.trim, trimestreDb)
      .ilike(macroField, macro);

    if (errTotal) continue;

    const { count: inventariados, error: errInv } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq(v.id, sucId)
      .eq(v.trim, trimestreDb)
      .ilike(macroField, macro)
      .gt(v.veces, 0);

    if (errInv) continue;

    const t = total ?? 0;
    const inv = inventariados ?? 0;
    porMacro.push({
      macro,
      total: t,
      inventariados: inv,
      pendientes: Math.max(0, t - inv),
      porcentaje: t > 0 ? Math.round((inv / t) * 100) : 0,
    });
  }

  return porMacro;
}

/**
 * Progreso de inventario diario vs base_productos del trimestre vigente
 * (fechainicio <= hoy <= fechafin).
 */
export async function obtenerProgresoTrimestreSucursal(
  admin: SupabaseClient,
  sucId: number,
  hoyStrArgentina: string
): Promise<ProgresoTrimestreSucursal> {
  const vacio: ProgresoTrimestreSucursal = {
    trimestre: '',
    fecha_inicio: '',
    fecha_fin: '',
    total: 0,
    inventariados: 0,
    pendientes: 0,
    porcentaje: 0,
  };

  for (const v of COLUMN_VARIANTS) {
    const { data: muestra, error: errMuestra } = await admin
      .from('base_productos')
      .select(`${v.trim}, ${v.ini}, ${v.fin}`)
      .eq(v.id, sucId)
      .lte(v.ini, hoyStrArgentina)
      .gte(v.fin, hoyStrArgentina)
      .limit(1);

    if (errMuestra) continue;

    const row = muestra?.[0] as Record<string, string | undefined> | undefined;
    const trimestreDb = String(row?.[v.trim] ?? '').trim();
    const fechaInicio = String(row?.[v.ini] ?? '').trim();
    const fechaFin = String(row?.[v.fin] ?? '').trim();
    if (!trimestreDb) return vacio;

    const por_macro = await obtenerProgresoPorMacroTrimestre(admin, v, sucId, trimestreDb);

    const totalDirecto = await contarBaseProductosProgresoPadron(admin, v, sucId, trimestreDb);
    const inventariadosDirecto = await contarBaseProductosProgresoPadron(admin, v, sucId, trimestreDb, {
      soloInventariados: true,
    });

    if (totalDirecto == null || inventariadosDirecto == null) continue;

    const desdeMacros = totalesDesdeProgresoPorMacro(por_macro);
    const total = totalDirecto;
    const inventariados = inventariadosDirecto;
    const pendientes = Math.max(0, total - inventariados);
    const porcentaje = total > 0 ? Math.round((inventariados / total) * 100) : 0;

    if (desdeMacros.total !== total) {
      console.warn('Progreso trimestre: total por macro no coincide con filtro OR', {
        sucId,
        trimestreDb,
        totalDirecto: total,
        totalPorMacro: desdeMacros.total,
      });
    }

    return {
      trimestre: trimestreDb,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      total,
      inventariados,
      pendientes,
      porcentaje,
      por_macro,
    };
  }

  return vacio;
}

/**
 * Progreso vs base_productos para una etiqueta de trimestre concreta (histórico o vigente).
 */
export async function obtenerProgresoPorTrimestreLabel(
  admin: SupabaseClient,
  sucId: number,
  trimestreDb: string,
  fechaInicio: string,
  fechaFin: string
): Promise<ProgresoTrimestreSucursal> {
  const vacio: ProgresoTrimestreSucursal = {
    trimestre: trimestreDb,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    total: 0,
    inventariados: 0,
    pendientes: 0,
    porcentaje: 0,
  };

  if (!trimestreDb.trim()) return vacio;

  for (const v of COLUMN_VARIANTS) {
    const por_macro = await obtenerProgresoPorMacroTrimestre(admin, v, sucId, trimestreDb);

    const totalDirecto = await contarBaseProductosProgresoPadron(admin, v, sucId, trimestreDb);
    const inventariadosDirecto = await contarBaseProductosProgresoPadron(admin, v, sucId, trimestreDb, {
      soloInventariados: true,
    });

    if (totalDirecto == null || inventariadosDirecto == null) continue;

    const total = totalDirecto;
    const inventariados = inventariadosDirecto;
    const pendientes = Math.max(0, total - inventariados);
    const porcentaje = total > 0 ? Math.round((inventariados / total) * 100) : 0;

    return {
      trimestre: trimestreDb,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      total,
      inventariados,
      pendientes,
      porcentaje,
      por_macro,
    };
  }

  return vacio;
}

const DIFERENCIA_INVENTARIO_CHUNK = 1000;

type OrigenInventarioTrimestre = 'cadena' | 'auditoria';

/** Productos distintos en controles cerrados del trimestre, filtrados por origen. */
async function idsProductosInventarioTrimestrePorOrigen(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string,
  opts: { origen: OrigenInventarioTrimestre; soloConDiferencia: boolean; sucId?: number }
): Promise<Set<string>> {
  const { desdeIso, hastaIso } = rangoFechasArgentinaIso(fechaInicio, fechaFin);
  const ids = new Set<string>();
  let offset = 0;

  while (true) {
    let q = admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, controles_inventario!inner(sucursal_id, estado, fecha_fin, origen, tipo)'
      )
      .eq('controles_inventario.estado', 'cerrado')
      .gte('controles_inventario.fecha_fin', desdeIso)
      .lte('controles_inventario.fecha_fin', hastaIso)
      .order('id', { ascending: true })
      .range(offset, offset + DIFERENCIA_INVENTARIO_CHUNK - 1);

    if (opts.soloConDiferencia) {
      q = q.eq('con_diferencias', 1);
    }
    if (opts.sucId != null) {
      q = q.eq('controles_inventario.sucursal_id', opts.sucId);
    }

    const { data, error } = await q;
    if (error) {
      console.error('idsProductosInventarioTrimestrePorOrigen:', error.message);
      break;
    }

    const batch = data ?? [];
    for (const row of batch) {
      const raw = row as {
        producto_id_sistema?: string;
        controles_inventario?: { origen?: string | null; tipo?: string | null } | Array<{
          origen?: string | null;
          tipo?: string | null;
        }>;
      };
      const controlRaw = raw.controles_inventario;
      const control = Array.isArray(controlRaw) ? controlRaw[0] : controlRaw;
      const esAud = esDiferenciaDeControlAuditoria(control);
      if (opts.origen === 'cadena' && esAud) continue;
      if (opts.origen === 'auditoria' && !esAud) continue;
      const pid = String(raw.producto_id_sistema ?? '').trim();
      if (pid) ids.add(pid);
    }
    if (batch.length < DIFERENCIA_INVENTARIO_CHUNK) break;
    offset += DIFERENCIA_INVENTARIO_CHUNK;
  }

  return ids;
}

/** Productos distintos con diferencia de controles de sucursal (excluye auditoría). */
async function idsProductosConDiferenciaInventarioTrimestre(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string,
  sucId?: number
): Promise<Set<string>> {
  return idsProductosInventarioTrimestrePorOrigen(admin, fechaInicio, fechaFin, {
    origen: 'cadena',
    soloConDiferencia: true,
    sucId,
  });
}

/** Productos distintos con diferencia en controles cerrados dentro del período. */
export async function contarProductosConDiferenciaInventarioTrimestre(
  admin: SupabaseClient,
  sucId: number,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const ids = await idsProductosConDiferenciaInventarioTrimestre(
    admin,
    fechaInicio,
    fechaFin,
    sucId
  );
  return ids.size;
}

/** Productos distintos con diferencia en el período (todas las sucursales, sin duplicar entre sucursales). */
export async function contarProductosConDiferenciaInventarioTrimestreGlobal(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const ids = await idsProductosConDiferenciaInventarioTrimestre(admin, fechaInicio, fechaFin);
  return ids.size;
}

/** Productos distintos inventariados en controles de auditoría (cerrados en el período). */
export async function contarProductosInventariadosAuditoriaTrimestreGlobal(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const ids = await idsProductosInventarioTrimestrePorOrigen(admin, fechaInicio, fechaFin, {
    origen: 'auditoria',
    soloConDiferencia: false,
  });
  return ids.size;
}

/** Productos distintos con diferencia en controles de auditoría (cerrados en el período). */
export async function contarProductosConDiferenciaAuditoriaTrimestreGlobal(
  admin: SupabaseClient,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const ids = await idsProductosInventarioTrimestrePorOrigen(admin, fechaInicio, fechaFin, {
    origen: 'auditoria',
    soloConDiferencia: true,
  });
  return ids.size;
}

/** Productos distintos cargados en controles de vencimiento (fecha_registro en el período). */
export async function contarProductosCargadosVencimientosTrimestre(
  admin: SupabaseClient,
  sucId: number,
  fechaInicio: string,
  fechaFin: string
): Promise<number> {
  const { desdeIso, hastaIso } = rangoIsoRegistroTrimestre(fechaInicio, fechaFin);

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select('producto_id_sistema, controles_vencimientos!inner(sucursal_id)')
    .eq('controles_vencimientos.sucursal_id', sucId)
    .gte('fecha_registro', desdeIso)
    .lte('fecha_registro', hastaIso)
    .eq('eliminado', 0);

  if (error) return 0;

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const pid = String((row as { producto_id_sistema?: string }).producto_id_sistema ?? '').trim();
    if (pid) ids.add(pid);
  }
  return ids.size;
}

const DETALLE_VENCIDO_CHUNK = 1000;

type DetalleVencidoPendienteRow = {
  id: string;
  producto_id_sistema: string;
  fecha_vencimiento?: string | null;
  cantidad?: number | null;
  vendido?: number | null;
};

function ymdFechaVencimiento(fv: string | null | undefined): string {
  return String(fv ?? '').slice(0, 10);
}

/** Ya venció en calendario (fecha_vencimiento YYYY-MM-DD &lt; hoy). */
function esFechaVencida(fv: string | null | undefined, hoyYmd: string): boolean {
  const ymd = ymdFechaVencimiento(fv);
  return Boolean(ymd && ymd < hoyYmd);
}

/**
 * Saldo pendiente de liquidar: cantidad en BD ya descuenta ventas parciales.
 * No usar devuelto=0: muchas líneas quedan devuelto=1 con stock aún cargado.
 */
function saldoPendienteVencido(row: DetalleVencidoPendienteRow): number {
  if (Number(row.vendido ?? 0) === 1) return 0;
  const cant = Number(row.cantidad ?? 0);
  if (!Number.isFinite(cant) || cant <= 0) return 0;
  return cant;
}

async function listarDetallesVencidosExpirados(
  admin: SupabaseClient,
  hoyYmd: string,
  sucId?: number
): Promise<DetalleVencidoPendienteRow[]> {
  const acumulado: DetalleVencidoPendienteRow[] = [];
  let offset = 0;

  while (true) {
    let q = admin
      .from('controles_vencimientos_detalle')
      .select(
        'id, producto_id_sistema, fecha_vencimiento, cantidad, vendido, controles_vencimientos!inner(sucursal_id)'
      )
      .lt('fecha_vencimiento', hoyYmd)
      .eq('eliminado', 0)
      .order('fecha_vencimiento', { ascending: false })
      .range(offset, offset + DETALLE_VENCIDO_CHUNK - 1);

    if (sucId != null) {
      q = q.eq('controles_vencimientos.sucursal_id', sucId);
    }

    const { data, error } = await q;
    if (error) {
      console.error('listarDetallesVencidosExpirados:', error.message);
      break;
    }

    const batch = (data ?? []) as DetalleVencidoPendienteRow[];
    acumulado.push(...batch);
    if (batch.length < DETALLE_VENCIDO_CHUNK) break;
    offset += DETALLE_VENCIDO_CHUNK;
  }

  return acumulado;
}

export interface MetricasVencidosStock {
  /** Productos distintos con saldo pendiente (mismo criterio que KPI vencidos con saldo). */
  productos_con_saldo: number;
  /** Unidades vendidas registradas en vencimientos_detalle_ventas (líneas con venc. &lt; hoy). */
  unidades_vendidas: number;
}

async function acumularMetricasVencidosDesdeFilas(
  admin: SupabaseClient,
  rows: DetalleVencidoPendienteRow[],
  hoyYmd: string
): Promise<MetricasVencidosStock> {
  const conSaldo = new Set<string>();
  const idsVencidos: string[] = [];

  for (const row of rows) {
    if (!esFechaVencida(row.fecha_vencimiento, hoyYmd)) continue;
    const pid = String(row.producto_id_sistema ?? '').trim();
    if (!pid) continue;
    const detalleId = String(row.id ?? '').trim();
    if (detalleId) idsVencidos.push(detalleId);
    if (saldoPendienteVencido(row) > 0) conSaldo.add(pid);
  }

  const ventasMap = await sumarCantidadVendidaPorDetalle(admin, idsVencidos);
  let unidades = 0;
  for (const q of ventasMap.values()) {
    if (Number.isFinite(q) && q > 0) unidades += q;
  }

  return {
    productos_con_saldo: conSaldo.size,
    unidades_vendidas: Math.max(0, Math.round(unidades)),
  };
}

export async function obtenerMetricasVencidosStock(
  admin: SupabaseClient,
  sucId: number,
  hoyYmd: string
): Promise<MetricasVencidosStock> {
  const rows = await listarDetallesVencidosExpirados(admin, hoyYmd, sucId);
  return acumularMetricasVencidosDesdeFilas(admin, rows, hoyYmd);
}

export async function obtenerMetricasVencidosStockGlobal(
  admin: SupabaseClient,
  hoyYmd: string
): Promise<MetricasVencidosStock> {
  const rows = await listarDetallesVencidosExpirados(admin, hoyYmd);
  return acumularMetricasVencidosDesdeFilas(admin, rows, hoyYmd);
}

/**
 * Productos distintos con stock vencido pendiente: fecha_vencimiento &lt; hoy, no eliminado,
 * saldo &gt; 0 y no vendido del todo (ventas parciales con cantidad restante cuentan).
 */
export async function contarProductosVencidosEnTrimestre(
  admin: SupabaseClient,
  sucId: number,
  _fechaInicio: string,
  _fechaFin: string,
  hoyYmd: string
): Promise<number> {
  return contarProductosVencidosPendientes(admin, sucId, hoyYmd);
}

export async function contarProductosVencidosPendientes(
  admin: SupabaseClient,
  sucId: number,
  hoyYmd: string
): Promise<number> {
  const m = await obtenerMetricasVencidosStock(admin, sucId, hoyYmd);
  return m.productos_con_saldo;
}

/** Productos distintos con stock vencido pendiente (todas las sucursales). */
export async function contarProductosVencidosEnTrimestreGlobal(
  admin: SupabaseClient,
  _fechaInicio: string,
  _fechaFin: string,
  hoyYmd: string
): Promise<number> {
  const m = await obtenerMetricasVencidosStockGlobal(admin, hoyYmd);
  return m.productos_con_saldo;
}

export async function contarUnidadesVencidosVendidosEnTrimestre(
  admin: SupabaseClient,
  sucId: number,
  _fechaInicio: string,
  _fechaFin: string,
  hoyYmd: string
): Promise<number> {
  const m = await obtenerMetricasVencidosStock(admin, sucId, hoyYmd);
  return m.unidades_vendidas;
}

export async function contarUnidadesVencidosVendidosEnTrimestreGlobal(
  admin: SupabaseClient,
  _fechaInicio: string,
  _fechaFin: string,
  hoyYmd: string
): Promise<number> {
  const m = await obtenerMetricasVencidosStockGlobal(admin, hoyYmd);
  return m.unidades_vendidas;
}

export function sumarCantidadDetalle(
  rows: Array<{ cantidad?: number | null }> | null | undefined
): number {
  return Math.max(
    0,
    Math.round(
      (rows ?? []).reduce((acc, r) => acc + Number(r.cantidad ?? 0), 0)
    )
  );
}

/**
 * Una consulta por sucursal: por vencer hasta fin de trimestre y rangos exclusivos por días hasta
 * fecha_vencimiento (calendario, comparado con fecha de hoy).
 */
export async function contarVentanasPorVencerEnTrimestre(
  admin: SupabaseClient,
  sucId: number,
  hoyVen: string,
  fechaFinTrimestre: string
): Promise<VentanasPorVencerTrimestre> {
  const vacio: VentanasPorVencerTrimestre = {
    total_trimestre: 0,
    por_vencer_primeros_30: 0,
    por_vencer_31_a_60: 0,
    por_vencer_61_a_90: 0,
  };
  if (!fechaFinTrimestre || fechaFinTrimestre < hoyVen) return vacio;

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select('cantidad, fecha_vencimiento, controles_vencimientos!inner(sucursal_id)')
    .eq('controles_vencimientos.sucursal_id', sucId)
    .gte('fecha_vencimiento', hoyVen)
    .lte('fecha_vencimiento', fechaFinTrimestre)
    .eq('devuelto', 0)
    .eq('eliminado', 0);

  if (error) return vacio;

  const rows = data as Array<{
    cantidad?: number | null;
    fecha_vencimiento?: string;
  }>;

  const limPrimer30 = menorYmd(fechaFinTrimestre, ymdAddDays(hoyVen, 30));
  const lim60 = menorYmd(fechaFinTrimestre, ymdAddDays(hoyVen, 60));
  const lim90 = menorYmd(fechaFinTrimestre, ymdAddDays(hoyVen, 90));

  const inicioBand60 = ymdAddDays(hoyVen, 31);
  const inicioBand90 = ymdAddDays(hoyVen, 61);

  for (const r of rows) {
    const fv = String(r.fecha_vencimiento ?? '').slice(0, 10);
    if (!fv) continue;
    const q = Number(r.cantidad ?? 0);
    if (!Number.isFinite(q) || q <= 0) continue;

    vacio.total_trimestre += q;

    if (fv <= limPrimer30) vacio.por_vencer_primeros_30 += q;
    else if (fv >= inicioBand60 && fv <= lim60) vacio.por_vencer_31_a_60 += q;
    else if (fv >= inicioBand90 && fv <= lim90) vacio.por_vencer_61_a_90 += q;
  }

  return vacio;
}

/** Unidades por vencer desde hoy hasta el fin del trimestre vigente (suma bandas + resto). */
export async function contarPorVencerEnTrimestre(
  admin: SupabaseClient,
  sucId: number,
  hoyVen: string,
  fechaFinTrimestre: string
): Promise<number> {
  const r = await contarVentanasPorVencerEnTrimestre(admin, sucId, hoyVen, fechaFinTrimestre);
  return r.total_trimestre;
}

/**
 * Stock vencido aún cargado en controles (ventana atrás desde
 * fecha_vencimiento, sin vendidos ni devueltos).
 */
export async function contarUnidadesVencidosStock(
  admin: SupabaseClient,
  sucId: number,
  hoyVen: string,
  diasAtras: number = VENCIDOS_VENTANA_DIAS_ATRAS
): Promise<number> {
  const desde = ymdAddDays(hoyVen, -Math.max(0, diasAtras));

  const { data, error } = await admin
    .from('controles_vencimientos_detalle')
    .select('cantidad, controles_vencimientos!inner(sucursal_id)')
    .eq('controles_vencimientos.sucursal_id', sucId)
    .gte('fecha_vencimiento', desde)
    .lt('fecha_vencimiento', hoyVen)
    .eq('vendido', 0)
    .eq('devuelto', 0)
    .eq('eliminado', 0);

  if (error) return 0;
  return sumarCantidadDetalle(data as Array<{ cantidad?: number | null }>);
}
