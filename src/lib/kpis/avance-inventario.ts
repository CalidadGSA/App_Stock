/**
 * KPI mensual «avance esperado vs avance real» del inventario diario.
 *
 * El inventario se planifica por trimestre: la base tiene N productos y se reparten entre los
 * días hábiles del trimestre. Entonces el avance esperado no es un número fijo sino la fracción
 * de días hábiles ya transcurridos: al día 1 se espera 0%, a mitad de trimestre 50%, y sobre el
 * cierre 100%. Comparado con el avance real da el desvío en puntos porcentuales.
 *
 * Los psicotrópicos cuentan vueltas completas (`sucursales.vueltas_psicos`), igual que en el
 * resto de la app: la meta es productos × vueltas.
 *
 * Los meses pasados se leen del snapshot `kpi_avance_inventario_mensual`, porque
 * `base_productos.vecesinventariado` solo guarda el estado de hoy. Si no hay snapshot, se
 * responde con el avance actual marcado como aproximado.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { contarDiasHabiles } from '@/lib/fechas/feriados-argentina';
import {
  obtenerProgresoPorTrimestreLabel,
  type ProgresoTrimestreMacro,
} from '@/lib/inventario/trimestre-base';
import { obtenerProgresoPorMacroDrogueria } from '@/lib/inventario/base-productos-drogueria';
import { leerVueltasPsicosSucursal } from '@/lib/inventario/vueltas-psicos-sucursal';
import { rangoCalendarioCuatrimestre, type Cuatrimestre } from '@/lib/inventario/trimestre-periodo';
import { rangoMesCalendarioYm } from '@/lib/inventario/informe-mensual-metricas';
import { fechaHoyArgentinaYmd } from '@/lib/utils';

export type FuenteAvance = 'actual' | 'snapshot' | 'aproximado';

export interface AvanceMacro {
  macro: string;
  /** Meta del trimestre (en psicotrópicos, productos × vueltas). */
  total: number;
  inventariados: number;
  esperado: number;
  real_pct: number;
  esperado_pct: number;
  /** real − esperado, en puntos porcentuales. Negativo = atrasado. */
  desvio_pp: number;
}

export interface AvanceInventarioKpi {
  estado: 'ok' | 'sin_base';
  error?: string;
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  /** Hasta qué día se mide: hoy si el mes está en curso, fin de mes si ya pasó. */
  fecha_corte: string;
  dias_habiles_totales: number;
  dias_habiles_transcurridos: number;
  total: number;
  inventariados: number;
  /** Conteos que deberían estar hechos a la fecha de corte. */
  esperado: number;
  real_pct: number;
  esperado_pct: number;
  desvio_pp: number;
  por_macro: AvanceMacro[];
  fuente: FuenteAvance;
  tomado_at: string | null;
}

const TABLA_SNAPSHOT = 'kpi_avance_inventario_mensual';

function porcentaje(parte: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

function vacio(trimestre: string, fechaInicio: string, fechaFin: string): AvanceInventarioKpi {
  return {
    estado: 'sin_base',
    error: `No hay base de productos cargada para ${trimestre}.`,
    trimestre,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    fecha_corte: fechaInicio,
    dias_habiles_totales: contarDiasHabiles(fechaInicio, fechaFin),
    dias_habiles_transcurridos: 0,
    total: 0,
    inventariados: 0,
    esperado: 0,
    real_pct: 0,
    esperado_pct: 0,
    desvio_pp: 0,
    por_macro: [],
    fuente: 'actual',
    tomado_at: null,
  };
}

/** Trimestre calendario que contiene el mes. */
export function trimestreDelMes(year: number, month: number): {
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
} {
  const cuatrimestre = (Math.ceil(month / 3) || 1) as Cuatrimestre;
  const { fecha_inicio, fecha_fin } = rangoCalendarioCuatrimestre(year, cuatrimestre);
  return { trimestre: `Q${cuatrimestre}${year}`, fecha_inicio, fecha_fin };
}

/**
 * Último día que se mide: hoy para el mes en curso, el último día del mes si ya pasó, y nunca
 * fuera del trimestre.
 */
function fechaCorte(finDeMes: string, fechaInicio: string, fechaFin: string): string {
  const hoy = fechaHoyArgentinaYmd();
  const corte = finDeMes < hoy ? finDeMes : hoy;
  if (corte < fechaInicio) return fechaInicio;
  if (corte > fechaFin) return fechaFin;
  return corte;
}

function armar(
  trimestre: string,
  fechaInicio: string,
  fechaFin: string,
  corte: string,
  porMacro: ProgresoTrimestreMacro[],
  fuente: FuenteAvance,
  tomadoAt: string | null
): AvanceInventarioKpi {
  const diasTotales = contarDiasHabiles(fechaInicio, fechaFin);
  const diasTranscurridos = Math.min(diasTotales, contarDiasHabiles(fechaInicio, corte));
  const fraccion = diasTotales > 0 ? diasTranscurridos / diasTotales : 0;

  const macros: AvanceMacro[] = porMacro.map((m) => {
    const esperado = Math.round(m.total * fraccion);
    const realPct = porcentaje(m.inventariados, m.total);
    const espPct = Math.round(fraccion * 1000) / 10;
    return {
      macro: m.macro,
      total: m.total,
      inventariados: m.inventariados,
      esperado,
      real_pct: realPct,
      esperado_pct: espPct,
      desvio_pp: Math.round((realPct - espPct) * 10) / 10,
    };
  });

  const total = macros.reduce((acc, m) => acc + m.total, 0);
  const inventariados = macros.reduce((acc, m) => acc + m.inventariados, 0);
  const esperado = Math.round(total * fraccion);
  const realPct = porcentaje(inventariados, total);
  const espPct = Math.round(fraccion * 1000) / 10;

  return {
    estado: 'ok',
    trimestre,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    fecha_corte: corte,
    dias_habiles_totales: diasTotales,
    dias_habiles_transcurridos: diasTranscurridos,
    total,
    inventariados,
    esperado,
    real_pct: realPct,
    esperado_pct: espPct,
    desvio_pp: Math.round((realPct - espPct) * 10) / 10,
    por_macro: macros,
    fuente,
    tomado_at: tomadoAt,
  };
}

/** Avance real de hoy, desde base_productos (o la base de droguería). */
async function progresoActualPorMacro(
  admin: SupabaseClient,
  sucursalId: number,
  esDrogueria: boolean,
  trimestre: string,
  fechaInicio: string,
  fechaFin: string
): Promise<ProgresoTrimestreMacro[]> {
  if (esDrogueria) {
    const vueltas = await leerVueltasPsicosSucursal(admin, sucursalId);
    return obtenerProgresoPorMacroDrogueria(admin, trimestre, vueltas);
  }
  const progreso = await obtenerProgresoPorTrimestreLabel(
    admin,
    sucursalId,
    trimestre,
    fechaInicio,
    fechaFin
  );
  return progreso.por_macro ?? [];
}

export async function cargarAvanceInventario(
  admin: SupabaseClient,
  params: {
    sucursalId: number;
    year: number;
    month: number;
    esDrogueria: boolean;
    esMesActual: boolean;
  }
): Promise<AvanceInventarioKpi> {
  const { sucursalId, year, month, esDrogueria, esMesActual } = params;
  const { trimestre, fecha_inicio, fecha_fin } = trimestreDelMes(year, month);
  const { fecha_fin: finDeMes } = rangoMesCalendarioYm(year, month);
  const corte = fechaCorte(finDeMes, fecha_inicio, fecha_fin);
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  // Mes cerrado: el avance de aquel momento solo lo sabe el snapshot.
  if (!esMesActual) {
    const guardado = await leerSnapshot(admin, sucursalId, ym);
    if (guardado) {
      return armar(
        guardado.trimestre || trimestre,
        fecha_inicio,
        fecha_fin,
        corte,
        guardado.por_macro,
        'snapshot',
        guardado.tomado_at
      );
    }
  }

  const porMacro = await progresoActualPorMacro(
    admin,
    sucursalId,
    esDrogueria,
    trimestre,
    fecha_inicio,
    fecha_fin
  );

  if (porMacro.length === 0 || porMacro.every((m) => m.total === 0)) {
    return vacio(trimestre, fecha_inicio, fecha_fin);
  }

  // `vecesinventariado` es el estado de hoy. Vale como dato final si el mes está en curso, o si
  // es el último mes de un trimestre ya cerrado (ahí ya no se mueve). En el medio, es aproximado.
  const trimestreCerrado = fecha_fin < fechaHoyArgentinaYmd();
  const esDatoFinal = esMesActual || (trimestreCerrado && corte === fecha_fin);

  const kpi = armar(
    trimestre,
    fecha_inicio,
    fecha_fin,
    corte,
    porMacro,
    esDatoFinal ? 'actual' : 'aproximado',
    esDatoFinal ? new Date().toISOString() : null
  );

  // Mes en curso: dejar guardado el avance de hoy para cuando el mes sea pasado.
  if (esMesActual) {
    await guardarSnapshot(admin, sucursalId, ym, trimestre, porMacro);
  }

  return kpi;
}

interface SnapshotAvance {
  trimestre: string;
  por_macro: ProgresoTrimestreMacro[];
  tomado_at: string | null;
}

async function leerSnapshot(
  admin: SupabaseClient,
  sucursalId: number,
  ym: string
): Promise<SnapshotAvance | null> {
  const { data, error } = await admin
    .from(TABLA_SNAPSHOT)
    .select('trimestre, por_macro, tomado_at')
    .eq('sucursal_id', sucursalId)
    .eq('ym', ym)
    .maybeSingle();

  if (error) {
    if (!error.message?.includes(TABLA_SNAPSHOT)) {
      console.warn('kpi avance inventario (snapshot):', error.message);
    }
    return null;
  }
  if (!data) return null;

  const row = data as { trimestre?: string; por_macro?: unknown; tomado_at?: string };
  const porMacro = Array.isArray(row.por_macro) ? (row.por_macro as ProgresoTrimestreMacro[]) : [];
  if (porMacro.length === 0) return null;

  return {
    trimestre: String(row.trimestre ?? ''),
    por_macro: porMacro,
    tomado_at: row.tomado_at ?? null,
  };
}

/**
 * Guarda el avance del mes en curso. Se pisa cada vez, así que al cerrar el mes queda el
 * último valor visto, igual que el snapshot de stock valorizado.
 */
export async function guardarSnapshot(
  admin: SupabaseClient,
  sucursalId: number,
  ym: string,
  trimestre: string,
  porMacro: ProgresoTrimestreMacro[]
): Promise<void> {
  const total = porMacro.reduce((acc, m) => acc + m.total, 0);
  const inventariados = porMacro.reduce((acc, m) => acc + m.inventariados, 0);

  const { error } = await admin.from(TABLA_SNAPSHOT).upsert(
    {
      sucursal_id: sucursalId,
      ym,
      trimestre,
      total,
      inventariados,
      por_macro: porMacro,
      tomado_at: new Date().toISOString(),
    },
    { onConflict: 'sucursal_id,ym' }
  );

  if (error) console.warn('kpi avance inventario (guardar snapshot):', error.message);
}

/**
 * Para el cron diario: guarda el avance del mes en curso y, los primeros días del mes, también
 * el del mes anterior.
 *
 * Sin esa segunda pasada la foto del mes queda tomada *durante* el último día y pierde todo lo
 * que se cuente después de esa hora. Como el trimestre ya cerrado no cambia, volver a guardarlo
 * al día siguiente deja el valor definitivo.
 */
export async function tomarSnapshotAvanceConCierreDeMes(
  admin: SupabaseClient,
  sucursales: Array<{ id: number; esDrogueria: boolean }>,
  hoyYmd: string
): Promise<{ mesActual: number; mesAnterior: number }> {
  const ymActual = hoyYmd.slice(0, 7);
  const mesActual = await tomarSnapshotAvanceDiario(admin, sucursales, ymActual);

  // Los primeros días del mes se vuelve a cerrar el anterior, por si quedó contando gente.
  const diaDelMes = parseInt(hoyYmd.slice(8, 10), 10);
  if (!Number.isFinite(diaDelMes) || diaDelMes > DIAS_PARA_CERRAR_MES_ANTERIOR) {
    return { mesActual, mesAnterior: 0 };
  }

  const [anio, mes] = ymActual.split('-').map((x) => parseInt(x, 10));
  const anterior = mes > 1 ? `${anio}-${String(mes - 1).padStart(2, '0')}` : `${anio - 1}-12`;
  const mesAnterior = await tomarSnapshotAvanceDiario(admin, sucursales, anterior);

  return { mesActual, mesAnterior };
}

/** Cuántos días del mes nuevo se sigue reescribiendo la foto del mes anterior. */
const DIAS_PARA_CERRAR_MES_ANTERIOR = 5;

/** Para el cron diario: deja el avance del mes en curso de varias sucursales. */
export async function tomarSnapshotAvanceDiario(
  admin: SupabaseClient,
  sucursales: Array<{ id: number; esDrogueria: boolean }>,
  ym: string
): Promise<number> {
  const [yearRaw, monthRaw] = ym.split('-');
  const year = parseInt(yearRaw ?? '', 10);
  const month = parseInt(monthRaw ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0;

  const { trimestre, fecha_inicio, fecha_fin } = trimestreDelMes(year, month);
  let guardados = 0;

  for (const suc of sucursales) {
    try {
      const porMacro = await progresoActualPorMacro(
        admin,
        suc.id,
        suc.esDrogueria,
        trimestre,
        fecha_inicio,
        fecha_fin
      );
      if (porMacro.length === 0) continue;
      await guardarSnapshot(admin, suc.id, ym, trimestre, porMacro);
      guardados += 1;
    } catch (e) {
      console.warn(
        `tomarSnapshotAvanceDiario sucursal ${suc.id}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  return guardados;
}
