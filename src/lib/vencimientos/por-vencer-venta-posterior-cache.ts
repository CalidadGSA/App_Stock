const KEY_CHECK_HECHO = 'gs:por-vencer:venta-posterior-check-hecho';
const KEY_FLAGS = 'gs:por-vencer:venta-posterior-flags';

function puedeUsarSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

export function ventaPosteriorCheckHechoEnSesion(): boolean {
  if (!puedeUsarSessionStorage()) return false;
  return sessionStorage.getItem(KEY_CHECK_HECHO) === '1';
}

export function marcarVentaPosteriorCheckSesion(hecho: boolean): void {
  if (!puedeUsarSessionStorage()) return;
  if (hecho) {
    sessionStorage.setItem(KEY_CHECK_HECHO, '1');
  } else {
    sessionStorage.removeItem(KEY_CHECK_HECHO);
    sessionStorage.removeItem(KEY_FLAGS);
  }
}

export function leerFlagsVentaPosteriorSesion(): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!puedeUsarSessionStorage()) return map;
  try {
    const raw = sessionStorage.getItem(KEY_FLAGS);
    if (!raw) return map;
    const o = JSON.parse(raw) as Record<string, boolean>;
    for (const [id, flag] of Object.entries(o)) {
      map.set(id, !!flag);
    }
  } catch {
    // ignorar JSON corrupto
  }
  return map;
}

export function guardarFlagsVentaPosteriorSesion(flags: Map<string, boolean>): void {
  if (!puedeUsarSessionStorage()) return;
  const o: Record<string, boolean> = {};
  for (const [id, flag] of flags) {
    o[id] = !!flag;
  }
  sessionStorage.setItem(KEY_FLAGS, JSON.stringify(o));
}

export function fusionarFlagsVentaPosteriorEnItems<
  T extends { id: string; venta_posterior_a_carga?: boolean },
>(items: T[], flags: Map<string, boolean>): T[] {
  if (flags.size === 0) return items;
  return items.map((i) => ({
    ...i,
    venta_posterior_a_carga: flags.has(i.id)
      ? flags.get(i.id)!
      : (i.venta_posterior_a_carga ?? false),
  }));
}
