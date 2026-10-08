/**
 * Psicotrópicos con existencia en una sucursal, para el listado imprimible.
 *
 * Qué es psicotrópico lo decide `padron_final.proveedormarrone`; las existencias salen
 * del ERP de la sucursal (Onze) o de Quantio en la droguería. Se cruzan por `idproducto`.
 */

import { getPadronPool } from '@/lib/padron-final-db';
import { getOnzePool } from '@/lib/legacy-db/mysql-stock';
import { getQuantioPool } from '@/lib/legacy-db/quantio-mysql';

export interface PsicotropicoEnStock {
  idproducto: number;
  codebar: string;
  troquel: string;
  producto: string;
  laboratorio: string;
  cajas: number;
  unidades: number;
  unidadesPorCaja: number;
  precio: number | null;
  pvpTotal: number | null;
}

interface PsicoPadron {
  codebar: string;
  troquel: string;
  producto: string;
  laboratorio: string;
  precio: number | null;
}

const PRECIO_SQL =
  "CASE WHEN BTRIM(COALESCE(precio, '')) ~ '^-?[0-9]+([.,][0-9]+)?$' " +
  "THEN REPLACE(BTRIM(precio), ',', '.')::numeric END";

function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

async function leerPsicotropicosPadron(): Promise<Map<number, PsicoPadron>> {
  const { rows } = await getPadronPool().query(
    `SELECT DISTINCT ON (idproducto::bigint)
       idproducto::bigint                AS idproducto,
       COALESCE(BTRIM(codebar), '')      AS codebar,
       COALESCE(BTRIM(troquel), '')      AS troquel,
       COALESCE(BTRIM(producto), '')     AS producto,
       COALESCE(BTRIM(presentacion), '') AS presentacion,
       COALESCE(BTRIM(nombrelab), '')    AS laboratorio,
       ${PRECIO_SQL}                     AS precio
     FROM padron_final
     WHERE BTRIM(COALESCE(idproducto, '')) ~ '^[0-9]+$'
       AND UPPER(BTRIM(COALESCE(proveedormarrone, ''))) IN ('PSICOTROPICOS', 'PSICOTROPICO')
     ORDER BY idproducto::bigint`
  );

  const porProducto = new Map<number, PsicoPadron>();
  for (const r of rows as Array<Record<string, unknown>>) {
    porProducto.set(Number(r.idproducto), {
      codebar: String(r.codebar ?? ''),
      troquel: String(r.troquel ?? ''),
      producto: `${String(r.producto ?? '')} ${String(r.presentacion ?? '')}`.trim(),
      laboratorio: String(r.laboratorio ?? ''),
      precio: aNumero(r.precio),
    });
  }
  return porProducto;
}

interface FilaStock {
  idproducto: number;
  cajas: number;
  unidades: number;
  unidadesPorCaja: number;
  precio: number | null;
}

async function leerStockOnze(sucursalId: number, ids: number[]): Promise<FilaStock[]> {
  const pool = await getOnzePool();
  if (!pool) throw new Error('La base de stock de sucursales (Onze) no está configurada');

  const [rows] = (await pool.query(
    `SELECT s.IDProducto AS idproducto,
            s.Cantidad AS cajas,
            COALESCE(s.Unidades, 0) AS unidades,
            COALESCE(s.UnidadesProd, 0) AS unidades_prod,
            m.Precio AS precio
     FROM stock s
     LEFT JOIN medicamentos m ON m.CodPlex = s.IDProducto
     WHERE s.Sucursal = ?
       AND s.IDProducto IN (?)
       AND (s.Cantidad > 0 OR s.Unidades > 0)`,
    [sucursalId, ids]
  )) as [Array<Record<string, unknown>>, unknown];

  return rows.map((r) => ({
    idproducto: Number(r.idproducto),
    cajas: Number(r.cajas ?? 0),
    unidades: Number(r.unidades ?? 0),
    unidadesPorCaja: Number(r.unidades_prod ?? 0),
    precio: aNumero(r.precio),
  }));
}

/** La droguería tiene un único depósito en Quantio: no se filtra por sucursal. */
async function leerStockQuantio(ids: number[]): Promise<FilaStock[]> {
  const [rows] = (await getQuantioPool().query(
    `SELECT s.IDProducto AS idproducto, SUM(s.Cantidad) AS cajas
     FROM stock s
     WHERE s.IDProducto IN (?)
     GROUP BY s.IDProducto
     HAVING SUM(s.Cantidad) > 0`,
    [ids]
  )) as [Array<Record<string, unknown>>, unknown];

  return rows.map((r) => ({
    idproducto: Number(r.idproducto),
    cajas: Number(r.cajas ?? 0),
    unidades: 0,
    unidadesPorCaja: 0,
    precio: null,
  }));
}

export async function listarPsicotropicosEnStock(opts: {
  sucursalId: number;
  esDrogueria: boolean;
}): Promise<PsicotropicoEnStock[]> {
  const padron = await leerPsicotropicosPadron();
  if (padron.size === 0) return [];

  const ids = [...padron.keys()];
  const stock = opts.esDrogueria
    ? await leerStockQuantio(ids)
    : await leerStockOnze(opts.sucursalId, ids);

  const filas: PsicotropicoEnStock[] = [];
  for (const s of stock) {
    const p = padron.get(s.idproducto);
    if (!p) continue;

    const precio = s.precio ?? p.precio;
    const cajasEquivalentes =
      s.cajas + (s.unidadesPorCaja > 0 ? s.unidades / s.unidadesPorCaja : 0);

    filas.push({
      idproducto: s.idproducto,
      codebar: p.codebar,
      troquel: p.troquel,
      producto: p.producto,
      laboratorio: p.laboratorio,
      cajas: s.cajas,
      unidades: s.unidades,
      unidadesPorCaja: s.unidadesPorCaja,
      precio,
      pvpTotal: precio != null ? Math.round(precio * cajasEquivalentes * 100) / 100 : null,
    });
  }

  filas.sort((a, b) => a.producto.localeCompare(b.producto, 'es', { sensitivity: 'base' }));
  return filas;
}
