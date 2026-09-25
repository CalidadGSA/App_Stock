import type { createAdminClient } from '@/lib/supabase/server';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

export type OperadorOpcionFiltro = {
  id: number;
  nombre: string;
};

type FilaOperadorControl = {
  usuario_id: number | string | null;
  operadores?: { nombrecompleto?: string | null } | null;
};

function dedupeOperadores(filas: FilaOperadorControl[]): OperadorOpcionFiltro[] {
  const porId = new Map<number, string>();
  for (const fila of filas) {
    const id = Number(fila.usuario_id);
    if (!Number.isFinite(id) || id <= 0 || porId.has(id)) continue;
    const nombre =
      String(fila.operadores?.nombrecompleto ?? '').trim() || `Operador ${id}`;
    porId.set(id, nombre);
  }
  return Array.from(porId.entries())
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Operadores que tienen al menos un control de inventario en la sucursal. */
export async function listarOperadoresDeControlesInventario(
  admin: AdminClient,
  opts: {
    sucursalId: string | number;
    esAdmin: boolean;
    excluirAdminLike: string | null;
  }
): Promise<OperadorOpcionFiltro[]> {
  let q = admin
    .from('controles_inventario')
    .select('usuario_id, operadores(nombrecompleto)')
    .eq('sucursal_id', opts.sucursalId);

  if (!opts.esAdmin) {
    q = q.in('tipo', ['diario', 'ocasional_sucursal']);
  }
  if (opts.excluirAdminLike) {
    q = q.not('usuario_id', 'in', opts.excluirAdminLike);
  }

  const { data, error } = await q.limit(5000);
  if (error) return [];
  return dedupeOperadores((data ?? []) as FilaOperadorControl[]);
}

/** Operadores que tienen al menos un control de vencimientos en la sucursal. */
export async function listarOperadoresDeControlesVencimientos(
  admin: AdminClient,
  sucursalId: string | number
): Promise<OperadorOpcionFiltro[]> {
  const { data, error } = await admin
    .from('controles_vencimientos')
    .select('usuario_id, operadores(nombrecompleto)')
    .eq('sucursal_id', sucursalId)
    .limit(5000);
  if (error) return [];
  return dedupeOperadores((data ?? []) as FilaOperadorControl[]);
}
