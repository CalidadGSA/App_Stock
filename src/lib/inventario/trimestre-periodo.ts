import type { SupabaseClient } from '@supabase/supabase-js';
import { fechaHoyArgentinaYmd, rangoFechasArgentinaIso } from '@/lib/utils';

export type Cuatrimestre = 1 | 2 | 3 | 4;

export interface PeriodoTrimestreCalendario {
  anio: number;
  cuatrimestre: Cuatrimestre;
  fecha_inicio: string;
  fecha_fin: string;
  etiqueta: string;
}

export interface TrimestreDbOpcion {
  trimestre: string;
  fecha_inicio: string;
  fecha_fin: string;
  anio: number;
  cuatrimestre: Cuatrimestre;
}

const COLUMN_VARIANTS = [
  { trim: 'trimestre', ini: 'fechainicio', fin: 'fechafin' },
  { trim: 'trimestre', ini: 'fechaInicio', fin: 'fechaFin' },
] as const;

export function rangoCalendarioCuatrimestre(
  anio: number,
  cuatrimestre: Cuatrimestre
): { fecha_inicio: string; fecha_fin: string } {
  const mesInicio = (cuatrimestre - 1) * 3 + 1;
  const mesFin = cuatrimestre * 3;
  const fecha_inicio = `${anio}-${String(mesInicio).padStart(2, '0')}-01`;
  const ultimoDia = new Date(anio, mesFin, 0).getDate();
  const fecha_fin = `${anio}-${String(mesFin).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { fecha_inicio, fecha_fin };
}

export function etiquetaCuatrimestre(anio: number, cuatrimestre: Cuatrimestre): string {
  return `${cuatrimestre}° trimestre ${anio}`;
}

export function inferirCuatrimestreDesdeYmd(ymd: string): { anio: number; cuatrimestre: Cuatrimestre } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (!Number.isFinite(anio) || mes < 1 || mes > 12) return null;
  const cuatrimestre = (Math.ceil(mes / 3) || 1) as Cuatrimestre;
  return { anio, cuatrimestre };
}

export function cuatrimestreActualDesdeHoy(hoyYmd: string): PeriodoTrimestreCalendario {
  const inf = inferirCuatrimestreDesdeYmd(hoyYmd);
  const anio = inf?.anio ?? new Date().getFullYear();
  const cuatrimestre = inf?.cuatrimestre ?? 1;
  const { fecha_inicio, fecha_fin } = rangoCalendarioCuatrimestre(anio, cuatrimestre);
  return {
    anio,
    cuatrimestre,
    fecha_inicio,
    fecha_fin,
    etiqueta: etiquetaCuatrimestre(anio, cuatrimestre),
  };
}

export function parseCuatrimestreQuery(value: string | null): Cuatrimestre | null {
  const n = parseInt(String(value ?? ''), 10);
  if (n >= 1 && n <= 4) return n as Cuatrimestre;
  return null;
}

export function parseAnioQuery(value: string | null): number | null {
  const n = parseInt(String(value ?? ''), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return null;
}

function solapanRangos(iniA: string, finA: string, iniB: string, finB: string): boolean {
  return iniA <= finB && finA >= iniB;
}

/** Lista trimestres distintos en base_productos con fechas agregadas. */
export async function listarTrimestresEnBase(
  admin: SupabaseClient
): Promise<TrimestreDbOpcion[]> {
  const mapa = new Map<string, { ini: string; fin: string }>();

  for (const v of COLUMN_VARIANTS) {
    const { data, error } = await admin
      .from('base_productos')
      .select(`${v.trim}, ${v.ini}, ${v.fin}`)
      .limit(8000);

    if (error) continue;

    for (const row of data ?? []) {
      const r = row as Record<string, string | undefined>;
      const trim = String(r[v.trim] ?? '').trim();
      const ini = String(r[v.ini] ?? '').slice(0, 10);
      const fin = String(r[v.fin] ?? '').slice(0, 10);
      if (!trim || !ini || !fin) continue;

      const prev = mapa.get(trim);
      if (!prev) {
        mapa.set(trim, { ini, fin });
      } else {
        mapa.set(trim, {
          ini: ini < prev.ini ? ini : prev.ini,
          fin: fin > prev.fin ? fin : prev.fin,
        });
      }
    }
    if (mapa.size > 0) break;
  }

  const opciones: TrimestreDbOpcion[] = [];
  for (const [trimestre, { ini, fin }] of mapa) {
    const inf = inferirCuatrimestreDesdeYmd(ini) ?? inferirCuatrimestreDesdeYmd(fin);
    if (!inf) continue;
    opciones.push({
      trimestre,
      fecha_inicio: ini,
      fecha_fin: fin,
      anio: inf.anio,
      cuatrimestre: inf.cuatrimestre,
    });
  }

  opciones.sort((a, b) => {
    if (a.anio !== b.anio) return b.anio - a.anio;
    return b.cuatrimestre - a.cuatrimestre;
  });

  return opciones;
}

/** Resuelve etiqueta trimestre en BD que solapa el cuatrimestre calendario. */
export async function resolverTrimestreDbPorCalendario(
  admin: SupabaseClient,
  anio: number,
  cuatrimestre: Cuatrimestre
): Promise<TrimestreDbOpcion | null> {
  const cal = rangoCalendarioCuatrimestre(anio, cuatrimestre);
  const opciones = await listarTrimestresEnBase(admin);

  const candidatos = opciones.filter(
    (o) =>
      o.anio === anio &&
      o.cuatrimestre === cuatrimestre &&
      solapanRangos(o.fecha_inicio, o.fecha_fin, cal.fecha_inicio, cal.fecha_fin)
  );

  if (candidatos.length > 0) return candidatos[0];

  const porRango = opciones.filter((o) =>
    solapanRangos(o.fecha_inicio, o.fecha_fin, cal.fecha_inicio, cal.fecha_fin)
  );
  if (porRango.length > 0) return porRango[0];

  return {
    trimestre: etiquetaCuatrimestre(anio, cuatrimestre),
    fecha_inicio: cal.fecha_inicio,
    fecha_fin: cal.fecha_fin,
    anio,
    cuatrimestre,
  };
}

/** Trimestre vigente según hoy (fechainicio <= hoy <= fechafin en base_productos). */
export async function resolverTrimestreVigente(
  admin: SupabaseClient,
  hoyYmd: string
): Promise<TrimestreDbOpcion | null> {
  const opciones = await listarTrimestresEnBase(admin);
  const vigente = opciones.find(
    (o) => o.fecha_inicio <= hoyYmd && o.fecha_fin >= hoyYmd
  );
  if (vigente) return vigente;

  const actual = cuatrimestreActualDesdeHoy(hoyYmd);
  return resolverTrimestreDbPorCalendario(admin, actual.anio, actual.cuatrimestre);
}

export function rangoIsoRegistroTrimestre(fechaInicio: string, fechaFin: string) {
  return rangoFechasArgentinaIso(fechaInicio, fechaFin);
}

/** Fecha de corte para “vencido” y ventanas por vencer al visualizar un período. */
export function fechaCorteResumenTrimestre(
  hoyYmd: string,
  fechaInicio: string,
  fechaFin: string
): string {
  if (hoyYmd < fechaInicio) return fechaInicio;
  if (hoyYmd > fechaFin) return fechaFin;
  return hoyYmd;
}
