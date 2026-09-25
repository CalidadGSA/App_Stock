/**
 * Puente entre las bases viejas y las nuevas.
 *
 * Hasta Q32026 la base de productos se generaba clasificando por `cat_macro` del padrón, que
 * mezcla perfumería con farma y marca muchos psicotrópicos como farma. Eso se corregía al abrir
 * cada inventario, filtrando los productos contra `proveedormarrone` (ver
 * `filtrarIdsSinConflictoMacroPadron`), a costa de una consulta al padrón por apertura.
 *
 * Desde Q42026 la base ya se genera clasificada por `proveedormarrone`, así que ese filtro
 * sobra. Pero las bases anteriores siguen necesitándolo mientras se usen.
 *
 * **Cuando no quede ningún trimestre anterior a `PRIMER_TRIMESTRE_MACRO_POR_PROVEEDOR` en uso,
 * se puede borrar este módulo, el filtro y sus llamadas.**
 *
 * `INVENTARIO_TRIMESTRE_MACRO_PROVEEDOR` permite correr el corte sin tocar el código, por si
 * hay que regenerar un trimestre más tarde de lo previsto.
 */

/** Primer trimestre cuya base ya viene clasificada por proveedor. */
export const PRIMER_TRIMESTRE_MACRO_POR_PROVEEDOR = 'Q42026';

/** 'Q42026' → un número creciente, para poder comparar trimestres entre sí. */
function ordinalTrimestre(trimestre: string): number | null {
  const m = /^Q([1-4])(\d{4})$/.exec(String(trimestre ?? '').trim().toUpperCase());
  if (!m) return null;
  return Number(m[2]) * 4 + Number(m[1]);
}

function trimestreCorte(): string {
  const env = String(process.env.INVENTARIO_TRIMESTRE_MACRO_PROVEEDOR ?? '').trim();
  return ordinalTrimestre(env) ? env : PRIMER_TRIMESTRE_MACRO_POR_PROVEEDOR;
}

/**
 * ¿Hay que revalidar la macro contra el padrón al abrir un inventario de este trimestre?
 * Solo para las bases viejas. Un trimestre con formato raro se trata como viejo, que es lo
 * conservador: revalidar de más no rompe nada.
 */
export function baseRequiereFiltroMacroPadron(trimestre: string): boolean {
  const actual = ordinalTrimestre(trimestre);
  if (actual === null) return true;
  const corte = ordinalTrimestre(trimestreCorte());
  if (corte === null) return true;
  return actual < corte;
}
