import { cookies } from 'next/headers';
import { cache } from 'react';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RolOperador } from '@/lib/auth/roles';
import { cookieSecureFlag, OPERADOR_SESSION_MAX_AGE_SEC } from '@/lib/auth/cookie-config';
import { createAdminClient } from '@/lib/supabase/server';

const COOKIE_NAME = 'operador_session';
const MAX_AGE = OPERADOR_SESSION_MAX_AGE_SEC;

export interface OperadorSession {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  rol?: RolOperador;
  /** Versión de sesión; debe coincidir con operadores.session_version. */
  session_version?: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Falta AUTH_SECRET o SUPABASE_SERVICE_ROLE_KEY para firmar la sesión');
  return secret;
}

function sign(value: string): string {
  const secret = getSecret();
  const hmac = createHmac('sha256', secret);
  hmac.update(value);
  return hmac.digest('hex');
}

export function createOperadorSessionCookie(payload: OperadorSession): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    path: string;
    maxAge: number;
    sameSite: 'lax';
    secure?: boolean;
  };
} {
  const data = JSON.stringify({
    ...payload,
    session_version: Number(payload.session_version ?? 0),
  });
  const encoded = Buffer.from(data, 'utf8').toString('base64url');
  const signature = sign(encoded);
  const value = `${encoded}.${signature}`;
  return {
    name: COOKIE_NAME,
    value,
    options: {
      httpOnly: true,
      path: '/',
      maxAge: MAX_AGE,
      sameSite: 'lax',
      secure: cookieSecureFlag(),
    },
  };
}

/** Firma HMAC de un valor arbitrario (misma clave que la sesión). */
export function firmarValor(value: string): string {
  return sign(value);
}

/** Compara una firma en tiempo constante. */
export function firmaCoincide(value: string, sig: string): boolean {
  return signatureMatches(value, sig);
}

function signatureMatches(encoded: string, sig: string): boolean {
  const expected = Buffer.from(sign(encoded), 'utf8');
  const received = Buffer.from(sig, 'utf8');
  // Comparación en tiempo constante: evita filtrar la firma byte a byte por timing.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function verifyAndDecode(value: string): OperadorSession | null {
  try {
    const [encoded, sig] = value.split('.');
    if (!encoded || !sig) return null;
    if (!signatureMatches(encoded, sig)) return null;
    const data = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(data) as OperadorSession;
    if (typeof parsed.idoperador !== 'number' || typeof parsed.operador !== 'string') return null;
    if (parsed.rol && !['superadmin', 'admin', 'operador_sucursal'].includes(parsed.rol)) {
      parsed.rol = 'operador_sucursal';
    }
    if (parsed.session_version != null) {
      const v = Number(parsed.session_version);
      parsed.session_version = Number.isFinite(v) ? Math.floor(v) : 0;
    } else {
      parsed.session_version = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Compara la versión de sesión de la cookie contra la de BD (null en BD = migración no aplicada → no bloquear). */
export function sessionVersionCoincideConDb(
  session: OperadorSession,
  dbSessionVersion: number | null | undefined
): boolean {
  if (dbSessionVersion == null) return true;
  const dbVersion = Number(dbSessionVersion);
  const cookieVersion = Number(session.session_version ?? 0);
  const dbOk = Number.isFinite(dbVersion) ? Math.floor(dbVersion) : 0;
  const cookieOk = Number.isFinite(cookieVersion) ? Math.floor(cookieVersion) : 0;
  if (dbOk !== cookieOk) {
    console.warn('Sesión invalidada por session_version', {
      idoperador: session.idoperador,
      cookieOk,
      dbOk,
    });
    return false;
  }
  return true;
}

/** Fila mínima de `operadores` que necesitan sesión y RBAC (una sola consulta por request). */
export interface OperadorSessionDbRow {
  rol: string | null;
  app_role_id: number | null;
  session_version: number | null;
}

/**
 * Lee `operadores` para el operador de la sesión. Memoizado por request en Server Components
 * (React `cache`); en route handlers cada llamada consulta, por eso RBAC reutiliza esta misma
 * lectura en vez de repetirla.
 */
export const leerOperadorSessionRow = cache(
  async (idoperador: number): Promise<OperadorSessionDbRow | null> => {
    try {
      const admin = await createAdminClient();
      let { data, error } = await admin
        .from('operadores')
        .select('rol, app_role_id, session_version')
        .eq('idoperador', idoperador)
        .maybeSingle();

      // Migración 021 (session_version) aún no aplicada: leer el resto igual.
      if (error && String(error.message ?? '').includes('session_version')) {
        ({ data, error } = await admin
          .from('operadores')
          .select('rol, app_role_id')
          .eq('idoperador', idoperador)
          .maybeSingle());
      }

      if (error) {
        // Error de BD: no bloquear sesiones existentes.
        console.warn('leerOperadorSessionRow:', error.message);
        return null;
      }
      const row = data as Partial<OperadorSessionDbRow> | null;
      // Operador inexistente: versión 0 (una cookie con versión > 0 queda inválida).
      if (!row) return { rol: null, app_role_id: null, session_version: 0 };
      return {
        rol: row.rol ?? null,
        app_role_id: row.app_role_id ?? null,
        session_version: row.session_version ?? null,
      };
    } catch (err) {
      console.warn('leerOperadorSessionRow unexpected:', err);
      return null;
    }
  }
);

/** Sesión firmada de la cookie (sin tocar BD). */
export async function leerOperadorSessionCookie(): Promise<OperadorSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifyAndDecode(cookie);
}

/** Obtiene la sesión del operador desde las cookies (server) y valida session_version en BD. */
export const getOperadorSession = cache(async (): Promise<OperadorSession | null> => {
  const parsed = await leerOperadorSessionCookie();
  if (!parsed) return null;
  const row = await leerOperadorSessionRow(parsed.idoperador);
  if (!sessionVersionCoincideConDb(parsed, row?.session_version)) return null;
  return parsed;
});

/** Verifica el valor de la cookie (para middleware que recibe request). Solo usar en entorno Node (API/layout). */
export function getOperadorSessionFromCookieValue(cookieValue: string | undefined): OperadorSession | null {
  if (!cookieValue) return null;
  return verifyAndDecode(cookieValue);
}

/**
 * Comprueba solo el formato de la cookie de sesión (sin verificar firma).
 * Usar en middleware (Edge), donde Node crypto no está disponible.
 * La verificación real se hace en layout/API con getOperadorSession.
 */
export function hasValidSessionFormat(cookieValue: string | undefined): boolean {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const parts = cookieValue.split('.');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

export const OPERADOR_COOKIE_NAME = COOKIE_NAME;
