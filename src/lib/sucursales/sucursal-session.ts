import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  authCookieOptions,
  LEGACY_SUCURSAL_COOKIE_NAMES,
  SUCURSAL_COOKIE_NAME,
  SUCURSAL_SESSION_MAX_AGE_SEC,
} from '@/lib/auth/cookie-config';
import { firmarValor, firmaCoincide, leerOperadorSessionCookie } from '@/lib/auth/session';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export interface SucursalSession {
  /** `sucursales.sucursal` como string (así lo comparan las rutas). */
  id: string;
  nombre: string;
  codigo: string;
  esDrogueria: boolean;
  /** Operador al que pertenece esta selección; debe coincidir con la sesión. */
  idoperador: number;
}

type Payload = { s: string; n: string; c: string; d: 0 | 1; op: number };

function encode(payload: Payload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${firmarValor(encoded)}`;
}

function decode(value: string | undefined): SucursalSession | null {
  if (!value) return null;
  try {
    const [encoded, sig] = value.split('.');
    if (!encoded || !sig || !firmaCoincide(encoded, sig)) return null;
    const p = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<Payload>;
    const id = String(p.s ?? '').trim();
    const op = Number(p.op);
    if (!id || !Number.isFinite(op)) return null;
    return {
      id,
      nombre: String(p.n ?? ''),
      codigo: String(p.c ?? id),
      esDrogueria: Number(p.d ?? 0) === 1,
      idoperador: op,
    };
  } catch {
    return null;
  }
}

/**
 * Escribe la sucursal activa firmada y atada al operador logueado.
 * Borra las cookies viejas en texto plano si quedaron de una versión anterior.
 */
export async function setSucursalSessionCookie(
  cookieStore: CookieStore,
  sucursal: { id: number | string; nombre: string; esDrogueria: boolean },
  idoperador?: number
): Promise<void> {
  const op = idoperador ?? (await leerOperadorSessionCookie())?.idoperador;
  if (op == null) throw new Error('No hay sesión de operador para asociar la sucursal');
  const id = String(sucursal.id);
  cookieStore.set(
    SUCURSAL_COOKIE_NAME,
    encode({ s: id, n: sucursal.nombre, c: id, d: sucursal.esDrogueria ? 1 : 0, op }),
    authCookieOptions(SUCURSAL_SESSION_MAX_AGE_SEC)
  );
  for (const name of LEGACY_SUCURSAL_COOKIE_NAMES) {
    if (cookieStore.get(name)) cookieStore.delete(name);
  }
}

/**
 * Sucursal activa verificada: firma válida y perteneciente al operador de la sesión.
 * Memoizada por request en Server Components.
 */
export const getSucursalSession = cache(async (): Promise<SucursalSession | null> => {
  const cookieStore = await cookies();
  const suc = decode(cookieStore.get(SUCURSAL_COOKIE_NAME)?.value);
  if (!suc) return null;
  const operador = await leerOperadorSessionCookie();
  if (!operador || operador.idoperador !== suc.idoperador) return null;
  return suc;
});

/** Reemplazo directo de `cookieStore.get('sucursal_id')?.value`. */
export async function getSucursalIdSesion(): Promise<string | undefined> {
  return (await getSucursalSession())?.id;
}
