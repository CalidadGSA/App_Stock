/**
 * Base de productos a inventariar en la droguería, para un trimestre.
 *
 * Es el pipeline que corría en n8n (drogueria_pipeline.py), pero leyendo directo de
 * `plexdr` en vez de pasar por el bridge: `productos` tiene la ubicación física
 * (sector / módulo / fila / posición) y `stock` las existencias del depósito.
 *
 * Entran los productos que tienen registro de stock y además cantidad distinta de cero
 * o ubicación cargada. La categoría macro sale del padrón completo, sin filtrar por
 * activo: la droguería cuenta lo que tiene físicamente aunque el ERP lo marque inactivo.
 */

import { getQuantioPool } from '@/lib/legacy-db/quantio-mysql';
import type { CategoriaMacro } from '@/lib/inventario/generar-base/padron';

export interface FilaBaseDrogueria {
  idproducto: number;
  categoriamacro: CategoriaMacro;
  sector: number | null;
  modulo: string;
  fila: number | null;
  posicion: number | null;
  producto: string;
  presentacion: string;
  orden: number;
  trimestre: string;
  vecesinventariado: number;
  fechainicio: string;
  fechafin: string;
}

interface FilaTrabajoDrogueria {
  idproducto: number;
  categoriamacro: CategoriaMacro;
  sector: number | null;
  modulo: string;
  fila: number | null;
  posicion: number | null;
  producto: string;
  presentacion: string;
}

export interface ResumenBaseDrogueria {
  filas: FilaBaseDrogueria[];
  conteos: {
    productosDeposito: number;
    sinPadron: number;
    sinUbicacionCompleta: number;
  };
}

function aEnteroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cmpTexto(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/** Los nulos van al final, como hacía el `na_position="last"` del pipeline viejo. */
function cmpNumero(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export async function construirBaseDrogueria(opts: {
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  categoriaMacroPorProducto: Map<number, CategoriaMacro>;
  onPaso?: (mensaje: string) => void;
}): Promise<ResumenBaseDrogueria> {
  const { trimestre, fechaInicio, fechaFin, categoriaMacroPorProducto, onPaso } = opts;

  onPaso?.('Leyendo productos y stock de la droguería');

  const [filasPlex] = (await getQuantioPool().query(
    `SELECT p.IDProducto, p.Producto, p.Presentacion,
            p.Sector, p.Modulo, p.Fila, p.Posicion
     FROM productos p
     INNER JOIN stock s ON s.IDProducto = p.IDProducto
     WHERE s.Cantidad <> 0 OR p.Sector IS NOT NULL`
  )) as [Array<Record<string, unknown>>, unknown];

  onPaso?.('Cruzando con el padrón y ordenando por ubicación');

  const trabajo: FilaTrabajoDrogueria[] = [];
  let sinPadron = 0;
  let sinUbicacionCompleta = 0;

  for (const r of filasPlex) {
    const idproducto = Number(r.IDProducto);
    if (!Number.isFinite(idproducto)) continue;

    const macro = categoriaMacroPorProducto.get(idproducto);
    if (!macro) {
      sinPadron += 1;
      continue;
    }

    const sector = aEnteroONull(r.Sector);
    const fila = aEnteroONull(r.Fila);
    const posicion = aEnteroONull(r.Posicion);
    const modulo = String(r.Modulo ?? '').trim();

    if (sector === null || fila === null || posicion === null || modulo === '') {
      sinUbicacionCompleta += 1;
    }

    trabajo.push({
      idproducto,
      categoriamacro: macro,
      sector,
      modulo,
      fila,
      posicion,
      producto: String(r.Producto ?? '').trim(),
      presentacion: String(r.Presentacion ?? '').trim(),
    });
  }

  // El recorrido de la droguería es físico: sector, módulo, fila y posición.
  const porMacro = new Map<CategoriaMacro, FilaTrabajoDrogueria[]>();
  for (const f of trabajo) {
    const grupo = porMacro.get(f.categoriamacro);
    if (grupo) grupo.push(f);
    else porMacro.set(f.categoriamacro, [f]);
  }

  const filas: FilaBaseDrogueria[] = [];

  for (const grupo of porMacro.values()) {
    grupo.sort((a, b) => {
      const sector = cmpNumero(a.sector, b.sector);
      if (sector !== 0) return sector;
      const modulo = cmpTexto(a.modulo, b.modulo);
      if (modulo !== 0) return modulo;
      const fila = cmpNumero(a.fila, b.fila);
      if (fila !== 0) return fila;
      const posicion = cmpNumero(a.posicion, b.posicion);
      if (posicion !== 0) return posicion;
      const producto = cmpTexto(a.producto, b.producto);
      if (producto !== 0) return producto;
      const presentacion = cmpTexto(a.presentacion, b.presentacion);
      if (presentacion !== 0) return presentacion;
      return a.idproducto - b.idproducto;
    });

    grupo.forEach((f, indice) => {
      filas.push({
        idproducto: f.idproducto,
        categoriamacro: f.categoriamacro,
        sector: f.sector,
        modulo: f.modulo,
        fila: f.fila,
        posicion: f.posicion,
        producto: f.producto,
        presentacion: f.presentacion,
        orden: indice + 1,
        trimestre,
        vecesinventariado: 0,
        fechainicio: fechaInicio,
        fechafin: fechaFin,
      });
    });
  }

  validarBaseDrogueria(filas);

  return {
    filas,
    conteos: {
      productosDeposito: filasPlex.length,
      sinPadron,
      sinUbicacionCompleta,
    },
  };
}

/** Mismas validaciones que hacía validate_output en n8n. */
function validarBaseDrogueria(filas: FilaBaseDrogueria[]): void {
  if (filas.length === 0) {
    throw new Error('La base de la droguería quedó vacía.');
  }

  const productos = new Set<number>();
  const ordenes = new Set<string>();

  for (const f of filas) {
    if (productos.has(f.idproducto)) {
      throw new Error(`Producto repetido en la base de la droguería: ${f.idproducto}`);
    }
    productos.add(f.idproducto);

    const claveOrden = `${f.categoriamacro}|${f.orden}`;
    if (ordenes.has(claveOrden)) {
      throw new Error(`Orden repetido en ${f.categoriamacro}: ${f.orden}`);
    }
    ordenes.add(claveOrden);
  }
}
