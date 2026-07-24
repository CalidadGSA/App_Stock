import { cookies } from 'next/headers';
import { createHmac } from 'crypto';
import type { RolOperador } from '@/lib/auth/roles';
import { OPERADOR_SESSION_MAX_AGE_SEC } from '@/lib/auth/cookie-config';
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
      secure: process.env.NODE_ENV === 'production',
    },
  };
}

function verifyAndDecode(value: string): OperadorSession | null {
  try {
    const [encoded, sig] = value.split('.');
    if (!encoded || !sig) return null;
    if (sign(encoded) !== sig) return null;
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

async function sessionVersionCoincide(session: OperadorSession): Promise<boolean> {
  try {
    const admin = await createAdminClient();
    const { data, error } = await admin
      .from('operadores')
      .select('session_version')
      .eq('idoperador', session.idoperador)
      .maybeSingle();

    if (error) {
      // Migración aún no aplicada: no bloquear sesiones existentes.
      if (String(error.message ?? '').includes('session_version')) {
        return true;
      }
      console.warn('sessionVersionCoincide:', error.message);
      return true;
    }

    const dbVersion = Number(
      (data as { session_version?: number | null } | null)?.session_version ?? 0
    );
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
  } catch (err) {
    console.warn('sessionVersionCoincide unexpected:', err);
    return true;
  }
}

/** Obtiene la sesión del operador desde las cookies (server). */
export async function getOperadorSession(): Promise<OperadorSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  const parsed = verifyAndDecode(cookie);
  if (!parsed) return null;
  if (!(await sessionVersionCoincide(parsed))) return null;
  return parsed;
}

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
