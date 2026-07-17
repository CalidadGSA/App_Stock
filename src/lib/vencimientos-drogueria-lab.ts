import type { createAdminClient } from '@/lib/supabase/server';
import {
  esProductoControlado,
  nombreIndicaEstupefaciente,
  normalizarIdPsicofarmaco,
} from '@/lib/medicamentos/clasificacion-controlados';
import { fechaHoyArgentinaYmd, ymdDesdeIsoArgentina } from '@/lib/utils';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/** Valor interno del filtro «Sin droguería asignada». */
export const SIN_DROGUERIA_ASIGNADA = '__sin_drogueria_asignada__';

export const SIN_DROGUERIA_ASIGNADA_LABEL = 'Sin droguería asignada';

/** Valor interno del filtro «Trazables» en Separar por bulto. */
export const FILTRO_TRAZABLES = '__trazables__';

export const TRAZABLE_LABEL = 'Trazable';
export const FILTRO_TRAZABLES_LABEL = 'Trazables';

/**
 * Carga el set de productos trazables (tabla `trazables.idproducto`).
 * Si la tabla no existe o falla, devuelve set vacío.
 */
export async function cargarIdsTrazables(admin: AdminClient): Promise<Set<number>> {
  const out = new Set<number>();
  const chunkSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from('trazables')
      .select('idproducto')
      .range(from, from + chunkSize - 1);

    if (error) {
      console.warn('cargarIdsTrazables:', error.message);
      break;
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      const id = Number((row as { idproducto?: number }).idproducto);
      if (Number.isFinite(id) && id > 0) out.add(id);
    }

    if (batch.length < chunkSize) break;
    from += chunkSize;
  }

  return out;
}

export function esProductoTrazable(
  productoIdSistema: string | number | null | undefined,
  idsTrazables: Set<number>
): boolean {
  const id = Number(productoIdSistema);
  if (!Number.isFinite(id) || id <= 0) return false;
  return idsTrazables.has(id);
}

export type MacroBulto = 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS';

export type PadronProductoResumen = {
  cat_macro: string | null;
  categoria: string | null;
  subrubro: string | null;
};

export type DrogueriaLaboratorioRow = {
  drogueria: string;
  laboratorio: string;
  codlab: number;
};

export type MedicamentoDrogueriaMeta = {
  codlab: number | null;
  idpsicofarmaco: string | null;
};

const IDS_ESTUPEFACIENTE = new Set(['E', 'EST', 'ESTUPEFACIENTE', 'ESTUPEFACIENTES']);

export function normalizarCategoriaMacro(categoria: string | null | undefined): string | null {
  if (categoria == null || String(categoria).trim() === '') return null;
  return String(categoria).trim().toUpperCase();
}

/** `cat_macro` del padrón → macro normalizada (misma convención que diferencias-resumen). */
export function esEtiquetaOtc(valor: string | null | undefined): boolean {
  return normalizarCategoriaMacro(valor) === 'OTC';
}

/** `cat_macro` del padrón → macro normalizada (misma convención que diferencias-resumen). */
export function macroDesdePadron(
  catMacroPadron: string | null | undefined
): MacroBulto | null {
  const c = normalizarCategoriaMacro(catMacroPadron);
  if (!c) return null;
  if (c === 'PSICOTROPICO' || c === 'PSICOTROPICOS') return 'PSICOTROPICOS';
  if (c === 'BIENESTAR') return 'BIENESTAR';
  if (c === 'FARMA') return 'FARMA';
  if (c === 'OTC') return 'FARMA';
  return null;
}

/** OTC en padrón (cat_macro o categoria): venta libre, devolución con reglas FARMA. */
export function esProductoOtcPadron(padron: PadronProductoResumen | undefined): boolean {
  if (!padron) return false;
  return esEtiquetaOtc(padron.cat_macro) || esEtiquetaOtc(padron.categoria);
}

/** Macro desde padrón considerando también `categoria` (ej. OTC sin cat_macro). */
export function macroDesdePadronCompleto(
  padron: PadronProductoResumen | undefined,
  controlCategoriaMacro?: string | null
): MacroBulto | null {
  if (esProductoOtcPadron(padron)) return 'FARMA';
  const desdeMacro = macroDesdePadron(padron?.cat_macro);
  if (desdeMacro) return desdeMacro;
  const desdeControl = macroDesdePadron(controlCategoriaMacro);
  if (desdeControl) return desdeControl;
  return null;
}

/**
 * ¿Este producto entra en «Separar por bulto»?
 * - FARMA (padrón) o sin macro en padrón → se evalúa por codlab.
 * - BIENESTAR / PSICOTROPICOS (padrón o psicofármaco) → no.
 */
export function aplicaBultoDrogueria(macro: MacroBulto | null): boolean {
  return macro !== 'BIENESTAR' && macro !== 'PSICOTROPICOS';
}

export function padronParaProducto(
  map: Map<string, PadronProductoResumen>,
  productoId: string
): PadronProductoResumen | undefined {
  const pid = String(productoId).trim();
  if (!pid) return undefined;
  const direct = map.get(pid);
  if (direct) return direct;
  const num = Number(pid);
  if (Number.isFinite(num)) return map.get(String(num));
  return undefined;
}

export function macroBultoParaProducto(
  padron: PadronProductoResumen | undefined,
  medicamentoMeta: MedicamentoDrogueriaMeta | undefined,
  nombrePsicoPorId: Map<string, string>
): MacroBulto | null {
  const desdePadron = macroDesdePadron(padron?.cat_macro);
  if (desdePadron) return desdePadron;

  const idPsico = medicamentoMeta?.idpsicofarmaco ?? null;
  if (esPsicotropicoOEstupefacienteParaBulto(idPsico, nombrePsicoPorId)) {
    return 'PSICOTROPICOS';
  }

  return null;
}

export function controlVencimientoDesdeFila(row: {
  controles_vencimientos?: unknown;
}): { sucursal_id?: number } | null {
  const cv = row.controles_vencimientos;
  const control = Array.isArray(cv) ? cv[0] : cv;
  if (!control || typeof control !== 'object') return null;
  const c = control as { sucursal_id?: unknown };
  return {
    sucursal_id:
      c.sucursal_id != null && Number.isFinite(Number(c.sucursal_id))
        ? Number(c.sucursal_id)
        : undefined,
  };
}

export function metaMedicamentoPorProducto(
  map: Map<string, MedicamentoDrogueriaMeta>,
  productoId: string
): MedicamentoDrogueriaMeta | undefined {
  const pid = String(productoId).trim();
  if (!pid) return undefined;
  const direct = map.get(pid);
  if (direct) return direct;
  const num = Number(pid);
  if (Number.isFinite(num)) return map.get(String(num));
  return undefined;
}

function guardarMetaMedicamento(
  map: Map<string, MedicamentoDrogueriaMeta>,
  codplex: string,
  meta: MedicamentoDrogueriaMeta
) {
  map.set(codplex, meta);
  const num = Number(codplex);
  if (Number.isFinite(num)) map.set(String(num), meta);
}

/** Psicotrópico/estupefaciente real (catálogo o código E), no cualquier id distinto de N. */
export function esPsicotropicoOEstupefacienteParaBulto(
  idPsicofarmaco: string | null | undefined,
  nombrePsicoPorId: Map<string, string>
): boolean {
  if (!esProductoControlado(idPsicofarmaco)) return false;

  const id = normalizarIdPsicofarmaco(idPsicofarmaco);
  if (IDS_ESTUPEFACIENTE.has(id)) return true;

  const raw = String(idPsicofarmaco ?? '').trim();
  const nombre =
    nombrePsicoPorId.get(raw) ?? nombrePsicoPorId.get(id) ?? '';
  if (nombreIndicaEstupefaciente(nombre)) return true;

  return nombre.length > 0;
}

export async function cargarMapaDrogueriaPorCodlab(admin: AdminClient) {
  const { data, error } = await admin
    .from('vencimientos_drogueria_laboratorio')
    .select('drogueria, laboratorio, codlab')
    .order('drogueria')
    .order('laboratorio');

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as DrogueriaLaboratorioRow[];
  const porCodlab = new Map<number, DrogueriaLaboratorioRow>();
  const droguerias = new Set<string>();

  for (const r of rows) {
    const codlab = Number(r.codlab);
    if (!Number.isFinite(codlab)) continue;
    porCodlab.set(codlab, {
      drogueria: String(r.drogueria ?? '').trim(),
      laboratorio: String(r.laboratorio ?? '').trim(),
      codlab,
    });
    if (r.drogueria) droguerias.add(String(r.drogueria).trim());
  }

  return {
    porCodlab,
    droguerias: Array.from(droguerias).sort((a, b) => a.localeCompare(b, 'es')),
  };
}

export async function cargarMedicamentoMetaPorProducto(
  admin: AdminClient,
  productoIds: string[]
): Promise<Map<string, MedicamentoDrogueriaMeta>> {
  const ids = Array.from(new Set(productoIds.map((id) => String(id).trim()).filter(Boolean)));
  const out = new Map<string, MedicamentoDrogueriaMeta>();
  if (ids.length === 0) return out;

  const chunkSize = 400;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const lote = ids.slice(i, i + chunkSize);
    const codplexNums = Array.from(
      new Set(
        lote
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n))
      )
    );
    if (codplexNums.length === 0) continue;

    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, codlab, idpsicofarmaco')
      .in('codplex', codplexNums);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      const codplex = String((m as { codplex?: string | number }).codplex ?? '').trim();
      if (!codplex) continue;
      const codlabRaw = (m as { codlab?: number | null }).codlab;
      const codlab = codlabRaw != null && Number.isFinite(Number(codlabRaw)) ? Number(codlabRaw) : null;
      const idpsicofarmaco = (m as { idpsicofarmaco?: string | null }).idpsicofarmaco ?? null;
      guardarMetaMedicamento(out, codplex, { codlab, idpsicofarmaco });
    }
  }
  return out;
}

/** `codplex` → `idsubrubro` (tabla medicamentos). */
export async function cargarIdSubrubroPorProducto(
  admin: AdminClient,
  productoIds: string[]
): Promise<Map<string, number | null>> {
  const ids = Array.from(new Set(productoIds.map((id) => String(id).trim()).filter(Boolean)));
  const out = new Map<string, number | null>();
  if (ids.length === 0) return out;

  const chunkSize = 400;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const lote = ids.slice(i, i + chunkSize);
    const codplexNums = Array.from(
      new Set(
        lote
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n))
      )
    );
    if (codplexNums.length === 0) continue;

    const { data, error } = await admin
      .from('medicamentos')
      .select('codplex, idsubrubro')
      .in('codplex', codplexNums);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      const codplex = String((m as { codplex?: string | number }).codplex ?? '').trim();
      if (!codplex) continue;
      const raw = (m as { idsubrubro?: number | null }).idsubrubro;
      const idsubrubro =
        raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
      out.set(codplex, idsubrubro);
      const num = Number(codplex);
      if (Number.isFinite(num)) out.set(String(num), idsubrubro);
    }
  }
  return out;
}

/** Droguería destino según codlab en vencimientos_drogueria_laboratorio. */
export function drogueriaDesdeCodlab(
  codlab: number | null | undefined,
  drogueriaPorCodlab: Map<number, DrogueriaLaboratorioRow>
): string | null {
  if (codlab == null || !Number.isFinite(Number(codlab))) return null;
  const row = drogueriaPorCodlab.get(Number(codlab));
  return row?.drogueria ? String(row.drogueria).trim() : null;
}

export async function cargarNombresPsicofarmacos(admin: AdminClient): Promise<Map<string, string>> {
  const { data, error } = await admin.from('psicofarmacos').select('idpsicofarmaco, nombre');
  if (error) throw new Error(error.message);

  const nombrePsicoPorId = new Map<string, string>();
  for (const p of data ?? []) {
    const id = String((p as { idpsicofarmaco?: string }).idpsicofarmaco ?? '').trim();
    const nombre = String((p as { nombre?: string }).nombre ?? '').trim();
    if (id) {
      nombrePsicoPorId.set(id, nombre);
      nombrePsicoPorId.set(id.toUpperCase(), nombre);
    }
  }
  return nombrePsicoPorId;
}

/** Mes calendario de vencimiento anterior al mes actual (Argentina). */
export function vencioMesAnteriorAlActual(
  fechaVencimiento: string,
  hoyYmd: string = fechaHoyArgentinaYmd()
): boolean {
  const fv = normalizarYmd(fechaVencimiento);
  const hoy = normalizarYmd(hoyYmd);
  if (!fv || !hoy) return false;
  return fv.slice(0, 7) < hoy.slice(0, 7);
}

function normalizarYmd(fecha: string): string {
  const raw = String(fecha ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return ymdDesdeIsoArgentina(raw);
}

export function laboratorioEnMapaDrogueria(
  item: { producto_id_sistema: string; laboratorio: string | null },
  medicamentoMeta: MedicamentoDrogueriaMeta | undefined,
  drogueriaPorCodlab: Map<number, DrogueriaLaboratorioRow>
): boolean {
  const codlab = medicamentoMeta?.codlab ?? null;
  if (codlab != null && drogueriaPorCodlab.has(codlab)) return true;

  const lab = String(item.laboratorio ?? '').trim().toUpperCase();
  if (!lab) return false;
  for (const row of drogueriaPorCodlab.values()) {
    if (row.laboratorio.trim().toUpperCase() === lab) return true;
  }
  return false;
}

/** Psicotrópicos, estupefacientes, perfumería con lab mapeado: fuera del filtro por bulto. */
export function excluidoDeFiltroBulto(
  macroEfectiva: MacroBulto | null,
  item: { producto_id_sistema: string; laboratorio: string | null },
  medicamentoMeta: MedicamentoDrogueriaMeta | undefined,
  drogueriaPorCodlab: Map<number, DrogueriaLaboratorioRow>,
  nombrePsicoPorId: Map<string, string>
): boolean {
  if (macroEfectiva === 'PSICOTROPICOS') return true;

  const idPsico = medicamentoMeta?.idpsicofarmaco ?? null;
  if (esPsicotropicoOEstupefacienteParaBulto(idPsico, nombrePsicoPorId)) {
    return true;
  }

  if (
    macroEfectiva === 'BIENESTAR' &&
    laboratorioEnMapaDrogueria(item, medicamentoMeta, drogueriaPorCodlab)
  ) {
    return true;
  }

  return false;
}

export function etiquetaDrogueriaDevolucion(drogueria: string | null | undefined): string | null {
  if (!drogueria) return null;
  if (drogueria === SIN_DROGUERIA_ASIGNADA) return SIN_DROGUERIA_ASIGNADA_LABEL;
  if (drogueria === FILTRO_TRAZABLES) return FILTRO_TRAZABLES_LABEL;
  return drogueria;
}

export function textoBadgeDrogueriaDevolucion(drogueria: string | null | undefined): string | null {
  const et = etiquetaDrogueriaDevolucion(drogueria);
  if (!et) return null;
  return et.startsWith('Sin ') ? et : `Devolver en ${et}`;
}

/**
 * Asignación «Separar por bulto»:
 * producto_id → medicamentos.codlab → vencimientos_drogueria_laboratorio.drogueria
 * (padrón solo define si es FARMA / bienestar / psico para excluir).
 * Productos en tabla `trazables` no se asignan a ninguna droguería ni a «sin droguería».
 */
export function resolverDrogueriaDevolucion(
  item: {
    producto_id_sistema: string;
    laboratorio: string | null;
    fecha_vencimiento: string;
  },
  macroEfectiva: MacroBulto | null,
  medicamentoMeta: MedicamentoDrogueriaMeta | undefined,
  drogueriaPorCodlab: Map<number, DrogueriaLaboratorioRow>,
  nombrePsicoPorId: Map<string, string>,
  hoyYmd: string = fechaHoyArgentinaYmd(),
  idsTrazables?: Set<number>
): string | null {
  if (idsTrazables && esProductoTrazable(item.producto_id_sistema, idsTrazables)) {
    return null;
  }

  if (
    excluidoDeFiltroBulto(
      macroEfectiva,
      item,
      medicamentoMeta,
      drogueriaPorCodlab,
      nombrePsicoPorId
    )
  ) {
    return null;
  }

  if (!aplicaBultoDrogueria(macroEfectiva)) return null;

  const codlab = medicamentoMeta?.codlab ?? null;
  const drogueria = drogueriaDesdeCodlab(codlab, drogueriaPorCodlab);

  if (!drogueria) {
    return SIN_DROGUERIA_ASIGNADA;
  }

  if (vencioMesAnteriorAlActual(item.fecha_vencimiento, hoyYmd)) {
    return SIN_DROGUERIA_ASIGNADA;
  }

  return drogueria;
}

export function opcionesFiltroBulto(droguerias: string[]): string[] {
  const ordenadas = [...droguerias].sort((a, b) => a.localeCompare(b, 'es'));
  return [...ordenadas, SIN_DROGUERIA_ASIGNADA, FILTRO_TRAZABLES];
}

export function serializarPadronPorProducto(
  map: Map<string, PadronProductoResumen>
): Record<string, PadronProductoResumen> {
  return Object.fromEntries(map.entries());
}
