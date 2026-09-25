/**
 * Parte de `vencimientos-drogueria-lab` que consulta bases externas (onze_center).
 *
 * Va en un archivo aparte porque el módulo principal exporta helpers de etiquetas que usan
 * componentes cliente: si desde ahí se llega a `mysql2`, el bundle del browser no compila.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { getFichasMedicamento } from '@/lib/legacy-db/onze-medicamentos';
import { getNombresPsicofarmacosOnze } from '@/lib/legacy-db/onze-catalogos';
import {
  guardarMetaMedicamento,
  type MedicamentoDrogueriaMeta,
} from '@/lib/vencimientos-drogueria-lab';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

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

    const { fichas } = await getFichasMedicamento(admin, codplexNums);
    for (const [codplex, f] of fichas) {
      guardarMetaMedicamento(out, codplex, {
        codlab: f.codlab,
        idpsicofarmaco: f.idpsicofarmaco,
      });
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

    const { fichas } = await getFichasMedicamento(admin, codplexNums);
    for (const [codplex, f] of fichas) {
      out.set(codplex, f.idsubrubro);
      const num = Number(codplex);
      if (Number.isFinite(num)) out.set(String(num), f.idsubrubro);
    }
  }
  return out;
}

/** `IDPsicofarmaco` → nombre, desde onze_center. */
export async function cargarNombresPsicofarmacos(): Promise<Map<string, string>> {
  return getNombresPsicofarmacosOnze();
}
