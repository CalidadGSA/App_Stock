/**
 * Padrón de productos para armar las bases de inventario, leído de `padron_final`
 * (Postgres de abastecimiento). Reemplaza al Excel que usaban los scripts de n8n.
 */

import { getPadronPool } from '@/lib/padron-final-db';
import { macroDesdeProveedorMarrone } from '@/lib/vencimientos-drogueria-lab';

export type CategoriaMacro = 'Farma' | 'Bienestar' | 'Psicotropicos' | 'Sin padron';

export interface PadronProducto {
  idproducto: number;
  precio: number | null;
  categoria: string;
  catMacro: string;
  nombreLab: string;
  nombreProducto: string;
  formadesc: string;
  /** Categoría con la que se inventaría, ya resuelta. */
  macro: CategoriaMacro;
}

/** Minúsculas, sin acentos y sin espacios en los extremos. */
export function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Categorías que van a FARMA aunque el proveedor diga otra cosa. Es una decisión del negocio,
 * no una corrección de datos: se cuentan con Farma aunque Marrone los provea por otra vía.
 */
const CATEGORIAS_FORZAR_FARMA = new Set([
  'primeros auxilios',
  'nutricion',
  'nutricion deportiva',
  'ortopedia',
]);

const FORMAS_FORZAR_FARMA = new Set([
  'leches enteras/descremadas',
  'leches maternizadas',
  'leches medicamentosas',
]);

/**
 * Categoría macro con la que se arma el recorrido del inventario.
 *
 * La fuente de verdad es `proveedormarrone`, no `cat_macro`: en el padrón los psicotrópicos
 * suelen figurar como Farma y hay perfumería mezclada, y el resto de la app ya clasifica por
 * proveedor (ver `macroDesdeProveedorMarrone`). Lo que no tiene proveedor cargado
 * («Sin proveedor» o vacío) cae en «Sin padrón», que se inventaría al final del trimestre.
 */
export function resolverCategoriaMacro(
  proveedormarrone: string,
  categoria: string,
  formadesc: string
): CategoriaMacro {
  if (
    CATEGORIAS_FORZAR_FARMA.has(normalizarTexto(categoria)) ||
    FORMAS_FORZAR_FARMA.has(normalizarTexto(formadesc))
  ) {
    return 'Farma';
  }

  switch (macroDesdeProveedorMarrone(proveedormarrone)) {
    case 'PSICOTROPICOS':
      return 'Psicotropicos';
    case 'BIENESTAR':
      return 'Bienestar';
    case 'FARMA':
      return 'Farma';
    default:
      return 'Sin padron';
  }
}

/** Un producto está activo si el ERP lo marca activo o si se lo activó a mano desde la app. */
const ACTIVO_SQL =
  "(UPPER(BTRIM(COALESCE(activo, ''))) = 'S' OR UPPER(BTRIM(COALESCE(activomanual, ''))) = 'S')";

/** Todas las columnas de padron_final son text: lo no numérico queda en NULL. */
const PRECIO_SQL =
  "CASE WHEN BTRIM(COALESCE(precio, '')) ~ '^-?[0-9]+([.,][0-9]+)?$' " +
  "THEN REPLACE(BTRIM(precio), ',', '.')::numeric END";

function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export interface PadronActivos {
  porProducto: Map<number, PadronProducto>;
  forzadosAFarma: number;
}

/** Productos activos, con el forzado a FARMA ya aplicado. Para las bases de sucursales. */
export async function leerPadronActivos(): Promise<PadronActivos> {
  const { rows } = await getPadronPool().query(
    `SELECT
       idproducto::bigint                 AS idproducto,
       ${PRECIO_SQL}                      AS precio,
       COALESCE(BTRIM(categoria), '')     AS categoria,
       COALESCE(BTRIM(cat_macro), '')     AS cat_macro,
       COALESCE(BTRIM(nombrelab), '')     AS nombre_lab,
       COALESCE(BTRIM(producto), '')      AS producto,
       COALESCE(BTRIM(presentacion), '')  AS presentacion,
       COALESCE(BTRIM(formadesc), '')          AS formadesc,
       COALESCE(BTRIM(proveedormarrone), '')   AS proveedormarrone
     FROM padron_final
     WHERE BTRIM(COALESCE(idproducto, '')) ~ '^[0-9]+$'
       AND ${ACTIVO_SQL}`
  );

  const porProducto = new Map<number, PadronProducto>();
  let forzadosAFarma = 0;

  for (const row of rows as Array<Record<string, unknown>>) {
    const categoria = String(row.categoria ?? '');
    const formadesc = String(row.formadesc ?? '');
    const catMacro = String(row.cat_macro ?? '');
    const proveedor = String(row.proveedormarrone ?? '');

    if (
      CATEGORIAS_FORZAR_FARMA.has(normalizarTexto(categoria)) ||
      FORMAS_FORZAR_FARMA.has(normalizarTexto(formadesc))
    ) {
      forzadosAFarma += 1;
    }

    const producto = String(row.producto ?? '');
    const presentacion = String(row.presentacion ?? '');

    porProducto.set(Number(row.idproducto), {
      idproducto: Number(row.idproducto),
      precio: aNumero(row.precio),
      categoria,
      catMacro,
      nombreLab: String(row.nombre_lab ?? ''),
      nombreProducto: `${producto} ${presentacion}`.trim(),
      formadesc,
      macro: resolverCategoriaMacro(proveedor, categoria, formadesc),
    });
  }

  if (porProducto.size === 0) {
    throw new Error('padron_final no devolvió productos activos.');
  }

  return { porProducto, forzadosAFarma };
}

/**
 * Categoría macro de todo el padrón, sin filtrar por activo. Para la droguería, que
 * inventaría lo que tiene físicamente aunque el ERP marque el producto inactivo.
 */
export async function leerCategoriaMacroPadronCompleto(): Promise<Map<number, CategoriaMacro>> {
  const { rows } = await getPadronPool().query(
    `SELECT
       idproducto::bigint                    AS idproducto,
       COALESCE(BTRIM(categoria), '')        AS categoria,
       COALESCE(BTRIM(formadesc), '')        AS formadesc,
       COALESCE(BTRIM(proveedormarrone), '') AS proveedormarrone
     FROM padron_final
     WHERE BTRIM(COALESCE(idproducto, '')) ~ '^[0-9]+$'`
  );

  const porProducto = new Map<number, CategoriaMacro>();
  for (const row of rows as Array<Record<string, unknown>>) {
    porProducto.set(
      Number(row.idproducto),
      resolverCategoriaMacro(
        String(row.proveedormarrone ?? ''),
        String(row.categoria ?? ''),
        String(row.formadesc ?? '')
      )
    );
  }

  if (porProducto.size === 0) {
    throw new Error('padron_final no devolvió productos.');
  }

  return porProducto;
}
