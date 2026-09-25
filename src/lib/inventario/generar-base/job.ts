/**
 * Generación de las bases de inventario de un trimestre (sucursales + droguería).
 *
 * Tarda varios minutos, así que corre en segundo plano y deja el progreso en memoria:
 * la app corre con una sola instancia de PM2 en modo fork, así que alcanza. Si el proceso
 * se reinicia en el medio, el job se pierde y hay que volver a dispararlo.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { SUCURSAL_ID_DROGUERIA } from '@/lib/sucursales/drogueria';
import { contarDiasHabiles } from '@/lib/fechas/feriados-argentina';
import {
  leerCategoriaMacroPadronCompleto,
  leerPadronActivos,
  type PadronProducto,
} from '@/lib/inventario/generar-base/padron';
import { construirBaseSucursales } from '@/lib/inventario/generar-base/sucursales';
import { construirBaseDrogueria } from '@/lib/inventario/generar-base/drogueria';
import {
  construirCantidadInventario,
  leerVueltasPsicos,
  type EntradaCantidad,
} from '@/lib/inventario/generar-base/cantidad-inventario';
import {
  rangoCalendarioCuatrimestre,
  type Cuatrimestre,
} from '@/lib/inventario/trimestre-periodo';

const TAM_LOTE_INSERT = 1000;

export interface ParametrosGeneracion {
  anio: number;
  cuatrimestre: Cuatrimestre;
  /** Sucursales elegidas; puede incluir la droguería. */
  sucursales: number[];
  reemplazar: boolean;
}

export interface ResumenGeneracion {
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  sucursalesGeneradas: number[];
  incluyeDrogueria: boolean;
  filasSucursales: number;
  filasDrogueria: number;
  filasCantidadInventario: number;
  porCategoria: Record<string, number>;
  detalleSucursales: Array<{ idsucursal: number; filas: number }>;
  excluidos: {
    hospitalarios: number;
    precioMinimo: number;
    sinMovimiento: number;
    drogueriaSinPadron: number;
  };
  segundos: number;
}

export type EstadoGeneracion = 'inactivo' | 'corriendo' | 'completado' | 'error';

export interface ProgresoGeneracion {
  id: string;
  estado: EstadoGeneracion;
  paso: string;
  porcentaje: number;
  iniciado: string | null;
  terminado: string | null;
  operador: string | null;
  parametros: (ParametrosGeneracion & { trimestre: string }) | null;
  resumen: ResumenGeneracion | null;
  error: string | null;
  /** Los datos viejos ya se borraron: si falla acá, el trimestre queda incompleto. */
  escrituraIniciada: boolean;
}

const PROGRESO_INICIAL: ProgresoGeneracion = {
  id: '',
  estado: 'inactivo',
  paso: '',
  porcentaje: 0,
  iniciado: null,
  terminado: null,
  operador: null,
  parametros: null,
  resumen: null,
  error: null,
  escrituraIniciada: false,
};

type EstadoGlobal = { progreso: ProgresoGeneracion };

function estado(): EstadoGlobal {
  const g = globalThis as typeof globalThis & { __generarBaseProductos?: EstadoGlobal };
  if (!g.__generarBaseProductos) {
    g.__generarBaseProductos = { progreso: { ...PROGRESO_INICIAL } };
  }
  return g.__generarBaseProductos;
}

export function progresoGeneracion(): ProgresoGeneracion {
  return { ...estado().progreso };
}

export function etiquetaTrimestre(anio: number, cuatrimestre: Cuatrimestre): string {
  return `Q${cuatrimestre}${anio}`;
}

function actualizar(cambios: Partial<ProgresoGeneracion>): void {
  estado().progreso = { ...estado().progreso, ...cambios };
}

export type InicioGeneracion =
  | { ok: true; progreso: ProgresoGeneracion }
  | { ok: false; error: string; progreso: ProgresoGeneracion };

/**
 * Arranca la generación en segundo plano. Devuelve enseguida; el avance se consulta
 * con `progresoGeneracion()`.
 */
export function iniciarGeneracion(
  params: ParametrosGeneracion,
  operador: string
): InicioGeneracion {
  if (estado().progreso.estado === 'corriendo') {
    return {
      ok: false,
      error: 'Ya hay una generación en curso. Esperá a que termine.',
      progreso: progresoGeneracion(),
    };
  }

  const trimestre = etiquetaTrimestre(params.anio, params.cuatrimestre);

  estado().progreso = {
    ...PROGRESO_INICIAL,
    id: `${trimestre}-${Date.now()}`,
    estado: 'corriendo',
    paso: 'Preparando',
    iniciado: new Date().toISOString(),
    operador,
    parametros: { ...params, trimestre },
  };

  void ejecutar(params, trimestre).catch((e) => {
    actualizar({
      estado: 'error',
      terminado: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    });
  });

  return { ok: true, progreso: progresoGeneracion() };
}

async function ejecutar(params: ParametrosGeneracion, trimestre: string): Promise<void> {
  const comienzo = Date.now();
  const admin = await createAdminClient();

  const { fecha_inicio: fechaInicio, fecha_fin: fechaFin } = rangoCalendarioCuatrimestre(
    params.anio,
    params.cuatrimestre
  );

  const incluyeDrogueria = params.sucursales.includes(SUCURSAL_ID_DROGUERIA);
  const sucursalesFarmacia = params.sucursales.filter((s) => s !== SUCURSAL_ID_DROGUERIA);

  const paso = (mensaje: string, porcentaje: number) =>
    actualizar({ paso: mensaje, porcentaje });

  // ── Lectura ────────────────────────────────────────────────────────────────
  paso('Leyendo el padrón de productos', 3);
  const padron = sucursalesFarmacia.length
    ? (await leerPadronActivos()).porProducto
    : new Map<number, PadronProducto>();

  const sucursales = await construirBaseSucursales({
    sucursales: sucursalesFarmacia,
    trimestre,
    fechaInicio,
    fechaFin,
    padron,
    onPaso: (m) => paso(m, 10),
  });
  paso('Base de sucursales armada', 35);

  let drogueria: Awaited<ReturnType<typeof construirBaseDrogueria>> | null = null;
  if (incluyeDrogueria) {
    const categoriaMacroPorProducto = await leerCategoriaMacroPadronCompleto();
    drogueria = await construirBaseDrogueria({
      trimestre,
      fechaInicio,
      fechaFin,
      categoriaMacroPorProducto,
      onPaso: (m) => paso(m, 40),
    });
  }
  paso('Bases armadas', 45);

  // ── Cantidades diarias ─────────────────────────────────────────────────────
  const entradas: EntradaCantidad[] = sucursales.filas.map((f) => ({
    idsucursal: f.idsucursal,
    categoriamacro: f.categoriamacro,
  }));
  for (const f of drogueria?.filas ?? []) {
    entradas.push({ idsucursal: SUCURSAL_ID_DROGUERIA, categoriamacro: f.categoriamacro });
  }

  // Incluye la droguería: su selección diaria de psicotrópicos también se corta por
  // `vueltas_psicos` (base-productos-drogueria.ts), así que la meta tiene que usar el mismo valor.
  const vueltasPsicos = await leerVueltasPsicos(admin, params.sucursales);
  const cantidades = construirCantidadInventario({
    entradas,
    trimestre,
    fechaInicio,
    fechaFin,
    vueltasPsicos,
  });

  // ── Escritura ──────────────────────────────────────────────────────────────
  actualizar({ escrituraIniciada: true });
  paso('Borrando la base anterior del trimestre', 50);

  for (const sucursal of sucursalesFarmacia) {
    const { error } = await admin
      .from('base_productos')
      .delete()
      .eq('trimestre', trimestre)
      .eq('idsucursal', sucursal);
    if (error) throw new Error(`No se pudo borrar la base de la sucursal ${sucursal}: ${error.message}`);
  }

  if (incluyeDrogueria) {
    const { error } = await admin
      .from('base_productos_drogueria')
      .delete()
      .eq('trimestre', trimestre);
    if (error) throw new Error(`No se pudo borrar la base de la droguería: ${error.message}`);
  }

  const { error: errorCantidad } = await admin
    .from('cantidad_inventario')
    .delete()
    .eq('trimestre', trimestre)
    .in('idSucursal', params.sucursales);
  if (errorCantidad) {
    throw new Error(`No se pudo borrar cantidad_inventario: ${errorCantidad.message}`);
  }

  const totalFilas = sucursales.filas.length + (drogueria?.filas.length ?? 0);
  let escritas = 0;

  const avanceEscritura = (n: number) => {
    escritas += n;
    const proporcion = totalFilas > 0 ? escritas / totalFilas : 1;
    paso(
      `Guardando productos (${escritas.toLocaleString('es-AR')} de ${totalFilas.toLocaleString('es-AR')})`,
      55 + Math.round(proporcion * 40)
    );
  };

  await insertarEnLotes(admin, 'base_productos', sucursales.filas, avanceEscritura);
  if (drogueria) {
    await insertarEnLotes(admin, 'base_productos_drogueria', drogueria.filas, avanceEscritura);
  }

  paso('Guardando cantidades diarias', 97);
  await insertarEnLotes(admin, 'cantidad_inventario', cantidades, () => {});

  // ── Resumen ────────────────────────────────────────────────────────────────
  const porCategoria: Record<string, number> = {};
  for (const f of sucursales.filas) {
    porCategoria[f.categoriamacro] = (porCategoria[f.categoriamacro] ?? 0) + 1;
  }
  for (const f of drogueria?.filas ?? []) {
    porCategoria[f.categoriamacro] = (porCategoria[f.categoriamacro] ?? 0) + 1;
  }

  const porSucursal = new Map<number, number>();
  for (const f of sucursales.filas) {
    porSucursal.set(f.idsucursal, (porSucursal.get(f.idsucursal) ?? 0) + 1);
  }
  if (drogueria) porSucursal.set(SUCURSAL_ID_DROGUERIA, drogueria.filas.length);

  const resumen: ResumenGeneracion = {
    trimestre,
    fechaInicio,
    fechaFin,
    diasHabiles: contarDiasHabiles(fechaInicio, fechaFin),
    sucursalesGeneradas: [...porSucursal.keys()].sort((a, b) => a - b),
    incluyeDrogueria,
    filasSucursales: sucursales.filas.length,
    filasDrogueria: drogueria?.filas.length ?? 0,
    filasCantidadInventario: cantidades.length,
    porCategoria,
    detalleSucursales: [...porSucursal.entries()]
      .map(([idsucursal, filas]) => ({ idsucursal, filas }))
      .sort((a, b) => a.idsucursal - b.idsucursal),
    excluidos: {
      hospitalarios: sucursales.conteos.excluidosHospitalarios,
      precioMinimo: sucursales.conteos.excluidosPrecio,
      sinMovimiento: sucursales.conteos.excluidosSinMovimiento,
      drogueriaSinPadron: drogueria?.conteos.sinPadron ?? 0,
    },
    segundos: Math.round((Date.now() - comienzo) / 1000),
  };

  actualizar({
    estado: 'completado',
    paso: 'Listo',
    porcentaje: 100,
    terminado: new Date().toISOString(),
    resumen,
  });
}

async function insertarEnLotes(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  tabla: string,
  filas: object[],
  onAvance: (n: number) => void
): Promise<void> {
  for (let i = 0; i < filas.length; i += TAM_LOTE_INSERT) {
    const lote = filas.slice(i, i + TAM_LOTE_INSERT);

    // Un corte de red no debería tirar abajo una corrida de varios minutos.
    let ultimoError = '';
    let insertado = false;
    for (let intento = 1; intento <= 3 && !insertado; intento += 1) {
      const { error } = await admin.from(tabla).insert(lote);
      if (!error) {
        insertado = true;
        break;
      }
      ultimoError = error.message;
      if (intento < 3) await new Promise((r) => setTimeout(r, 1000 * intento));
    }

    if (!insertado) {
      throw new Error(
        `Falló el guardado en ${tabla} después de 3 intentos (fila ${i + 1}): ${ultimoError}`
      );
    }

    onAvance(lote.length);
  }
}

export interface BaseExistente {
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  porSucursal: Array<{ idsucursal: number; filas: number; inventariados: number }>;
  drogueria: { filas: number; inventariados: number } | null;
  total: number;
}

/** Qué hay cargado hoy para ese trimestre, para avisar antes de reemplazar. */
export async function leerBaseExistente(
  anio: number,
  cuatrimestre: Cuatrimestre,
  sucursales: number[]
): Promise<BaseExistente> {
  const admin = await createAdminClient();
  const trimestre = etiquetaTrimestre(anio, cuatrimestre);
  const { fecha_inicio: fechaInicio, fecha_fin: fechaFin } = rangoCalendarioCuatrimestre(
    anio,
    cuatrimestre
  );

  const porSucursal: BaseExistente['porSucursal'] = [];
  let total = 0;

  for (const sucursal of sucursales.filter((s) => s !== SUCURSAL_ID_DROGUERIA)) {
    const { count } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestre)
      .eq('idsucursal', sucursal);

    const { count: inventariados } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestre)
      .eq('idsucursal', sucursal)
      .gt('vecesinventariado', 0);

    if ((count ?? 0) > 0) {
      porSucursal.push({
        idsucursal: sucursal,
        filas: count ?? 0,
        inventariados: inventariados ?? 0,
      });
      total += count ?? 0;
    }
  }

  let drogueria: BaseExistente['drogueria'] = null;
  if (sucursales.includes(SUCURSAL_ID_DROGUERIA)) {
    const { count } = await admin
      .from('base_productos_drogueria')
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestre);
    const { count: inventariados } = await admin
      .from('base_productos_drogueria')
      .select('*', { count: 'exact', head: true })
      .eq('trimestre', trimestre)
      .gt('vecesinventariado', 0);

    if ((count ?? 0) > 0) {
      drogueria = { filas: count ?? 0, inventariados: inventariados ?? 0 };
      total += count ?? 0;
    }
  }

  return {
    trimestre,
    fechaInicio,
    fechaFin,
    diasHabiles: contarDiasHabiles(fechaInicio, fechaFin),
    porSucursal,
    drogueria,
    total,
  };
}
