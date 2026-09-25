/**
 * Valorización de diferencias de inventario teniendo en cuenta los **fraccionados**.
 *
 * El recuento guarda cajas y unidades sueltas por separado, y tanto el costo
 * (`medicamentos.Costo`) como el PVP son por caja. Para que una diferencia de unidades
 * sueltas valga lo que corresponde, se convierte a cajas equivalentes con
 * `medicamentos.Unidades` (unidades por caja): 10 comprimidos de una caja de 30 son 0,33 cajas.
 */

import { UNIDADES_POR_CAJA_DEFAULT } from '@/lib/legacy-db/onze-medicamentos';

/** Normaliza las unidades por caja (sin dato o inválido → 1, es decir "no fraccionable"). */
export function normalizarUnidadesPorCaja(valor: number | null | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : UNIDADES_POR_CAJA_DEFAULT;
}

/**
 * Diferencia expresada en cajas: cajas enteras + la fracción que representan las
 * unidades sueltas. Es la cantidad por la que hay que multiplicar el costo o el PVP.
 */
export function cajasEquivalentes(
  diffCajas: number,
  diffUnidades: number,
  unidadesPorCaja: number | null | undefined
): number {
  const cajas = Number.isFinite(diffCajas) ? diffCajas : 0;
  const unidades = Number.isFinite(diffUnidades) ? diffUnidades : 0;
  if (unidades === 0) return cajas;
  return cajas + unidades / normalizarUnidadesPorCaja(unidadesPorCaja);
}

/** Valor monetario de una diferencia (costo o PVP por caja × cajas equivalentes). */
export function valorDiferencia(
  diffCajas: number,
  diffUnidades: number,
  unidadesPorCaja: number | null | undefined,
  valorPorCaja: number | null | undefined
): number {
  const valor = Number(valorPorCaja);
  if (!Number.isFinite(valor) || valor === 0) return 0;
  return cajasEquivalentes(diffCajas, diffUnidades, unidadesPorCaja) * valor;
}
