/**
 * Base de productos a inventariar por sucursal, para un trimestre.
 *
 * Es el pipeline que corría en n8n (inventory_pipeline.py), con las mismas reglas:
 * stock + ventas de los últimos 365 días del ERP de farmacias, cruzados con el padrón;
 * se excluyen hospitalarios, lo que vale menos de $2.000 y lo que no tuvo movimiento;
 * y se numera el recorrido por sucursal y categoría macro.
 */

import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import {
  normalizarTexto,
  type CategoriaMacro,
  type PadronProducto,
} from '@/lib/inventario/generar-base/padron';

/** Por debajo de este precio no se inventaría (salvo que el padrón no tenga precio). */
export const PRECIO_MINIMO_INVENTARIO = 2000;

/** Días de facturación que se miran para decidir si un producto tuvo movimiento. */
export const VENTANA_VENTAS_DIAS = 365;

export interface FilaBaseProductos {
  idsucursal: number;
  idproducto: number;
  categoriamacro: CategoriaMacro;
  orden: number;
  trimestre: string;
  vecesinventariado: number;
  fechainicio: string;
  fechafin: string;
}

interface FilaTrabajo {
  idsucursal: number;
  idproducto: number;
  cantidadStock: number;
  totalFacturado: number;
  padron: PadronProducto | null;
  categoriamacro: CategoriaMacro;
}

export interface ResumenBaseSucursales {
  filas: FilaBaseProductos[];
  conteos: {
    stock: number;
    ventas: number;
    candidatos: number;
    excluidosHospitalarios: number;
    excluidosPrecio: number;
    excluidosSinMovimiento: number;
  };
}

/** Comparación por texto en español, insensible a acentos y mayúsculas. */
function cmpTexto(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

export async function construirBaseSucursales(opts: {
  sucursales: number[];
  trimestre: string;
  fechaInicio: string;
  fechaFin: string;
  padron: Map<number, PadronProducto>;
  onPaso?: (mensaje: string) => void;
}): Promise<ResumenBaseSucursales> {
  const { sucursales, trimestre, fechaInicio, fechaFin, padron, onPaso } = opts;

  if (sucursales.length === 0) {
    return {
      filas: [],
      conteos: {
        stock: 0,
        ventas: 0,
        candidatos: 0,
        excluidosHospitalarios: 0,
        excluidosPrecio: 0,
        excluidosSinMovimiento: 0,
      },
    };
  }

  const pool = await getOnzePool();
  if (!pool) throw new Error('No hay conexión con el ERP de farmacias (onze_center).');

  const marcadores = sucursales.map(() => '?').join(',');

  onPaso?.('Leyendo stock de las sucursales');
  const [filasStock] = (await pool.query(
    `SELECT Sucursal, IDProducto, Cantidad
     FROM Stock
     WHERE Sucursal IN (${marcadores})`,
    sucursales
  )) as [Array<Record<string, unknown>>, unknown];

  onPaso?.(`Leyendo ventas de los últimos ${VENTANA_VENTAS_DIAS} días`);
  const [filasVentas] = (await pool.query(
    `SELECT fl.IDProducto, fc.Sucursal, SUM(fl.Total) AS total_facturado
     FROM factlineas fl
     INNER JOIN factcabecera fc ON fl.IDComprobante = fc.IDComprobante
     LEFT JOIN factlineas nc
       ON fl.IDGlobal = nc.RefIDGlobal AND fl.Orden = nc.RefOrden
     WHERE fc.Emision >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND nc.RefIDGlobal IS NULL
       AND nc.RefOrden IS NULL
       AND fc.Tipo IN ('FV', 'ND', 'TF', 'TK')
       AND fc.Sucursal IN (${marcadores})
     GROUP BY fc.Sucursal, fl.IDProducto`,
    [VENTANA_VENTAS_DIAS, ...sucursales]
  )) as [Array<Record<string, unknown>>, unknown];

  onPaso?.('Cruzando stock, ventas y padrón');

  // Unión de stock y ventas: un producto entra si aparece en cualquiera de los dos.
  const trabajo = new Map<string, FilaTrabajo>();

  const tomar = (sucursal: number, producto: number): FilaTrabajo => {
    const clave = `${sucursal}|${producto}`;
    let fila = trabajo.get(clave);
    if (!fila) {
      const ficha = padron.get(producto) ?? null;
      fila = {
        idsucursal: sucursal,
        idproducto: producto,
        cantidadStock: 0,
        totalFacturado: 0,
        padron: ficha,
        // Sin ficha en el padrón activo, va a «Sin padrón» igual que los que no tienen proveedor.
        categoriamacro: ficha ? ficha.macro : 'Sin padron',
      };
      trabajo.set(clave, fila);
    }
    return fila;
  };

  for (const r of filasStock) {
    const sucursal = Number(r.Sucursal);
    const producto = Number(r.IDProducto);
    if (!Number.isFinite(sucursal) || !Number.isFinite(producto)) continue;
    tomar(sucursal, producto).cantidadStock += Number(r.Cantidad ?? 0) || 0;
  }

  for (const r of filasVentas) {
    const sucursal = Number(r.Sucursal);
    const producto = Number(r.IDProducto);
    if (!Number.isFinite(sucursal) || !Number.isFinite(producto)) continue;
    tomar(sucursal, producto).totalFacturado += Number(r.total_facturado ?? 0) || 0;
  }

  const candidatos = trabajo.size;
  let excluidosHospitalarios = 0;
  let excluidosPrecio = 0;
  let excluidosSinMovimiento = 0;

  const sobrevivientes: FilaTrabajo[] = [];

  for (const fila of trabajo.values()) {
    const nombre = fila.padron?.nombreProducto ?? '';
    const categoria = fila.padron?.categoria ?? '';

    if (nombre.toUpperCase().includes('HOSPI') || normalizarTexto(categoria) === 'hospitalarios') {
      excluidosHospitalarios += 1;
      continue;
    }

    const precio = fila.padron?.precio ?? null;
    if (precio !== null && precio < PRECIO_MINIMO_INVENTARIO) {
      excluidosPrecio += 1;
      continue;
    }

    if (fila.cantidadStock === 0 && fila.totalFacturado === 0) {
      excluidosSinMovimiento += 1;
      continue;
    }

    sobrevivientes.push(fila);
  }

  onPaso?.('Ordenando el recorrido por sucursal y categoría');

  // Cada categoría macro se recorre con un criterio distinto y se numera desde 1.
  const porSucursalYMacro = new Map<string, FilaTrabajo[]>();
  for (const fila of sobrevivientes) {
    const clave = `${fila.idsucursal}|${fila.categoriamacro}`;
    const grupo = porSucursalYMacro.get(clave);
    if (grupo) grupo.push(fila);
    else porSucursalYMacro.set(clave, [fila]);
  }

  const filas: FilaBaseProductos[] = [];

  for (const [clave, grupo] of porSucursalYMacro) {
    const macro = clave.split('|')[1] as CategoriaMacro;
    grupo.sort((a, b) => compararSegunMacro(macro, a, b));

    grupo.forEach((fila, indice) => {
      filas.push({
        idsucursal: fila.idsucursal,
        idproducto: fila.idproducto,
        categoriamacro: fila.categoriamacro,
        orden: indice + 1,
        trimestre,
        vecesinventariado: 0,
        fechainicio: fechaInicio,
        fechafin: fechaFin,
      });
    });
  }

  return {
    filas,
    conteos: {
      stock: filasStock.length,
      ventas: filasVentas.length,
      candidatos,
      excluidosHospitalarios,
      excluidosPrecio,
      excluidosSinMovimiento,
    },
  };
}

function compararSegunMacro(macro: CategoriaMacro, a: FilaTrabajo, b: FilaTrabajo): number {
  if (macro === 'Farma') {
    const lab = cmpTexto(a.padron?.nombreLab ?? '', b.padron?.nombreLab ?? '');
    if (lab !== 0) return lab;
  }

  if (macro === 'Bienestar') {
    const cat = cmpTexto(a.padron?.categoria ?? '', b.padron?.categoria ?? '');
    if (cat !== 0) return cat;
    const lab = cmpTexto(a.padron?.nombreLab ?? '', b.padron?.nombreLab ?? '');
    if (lab !== 0) return lab;
  }

  const nombre = cmpTexto(a.padron?.nombreProducto ?? '', b.padron?.nombreProducto ?? '');
  if (nombre !== 0) return nombre;
  return a.idproducto - b.idproducto;
}
