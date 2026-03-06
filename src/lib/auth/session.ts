import { cookies } from 'next/headers';
import { createHmac } from 'crypto';

const COOKIE_NAME = 'operador_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 días

export interface OperadorSession {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  rol?: 'admin' | 'operador_sucursal';
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

export function createOperadorSessionCookie(payload: OperadorSession): { name: string; value: string; options: { httpOnly: true; path: string; maxAge: number; sameSite: 'lax'; secure?: boolean } } {
  const data = JSON.stringify(payload);
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
    if (parsed.rol && !['admin', 'operador_sucursal'].includes(parsed.rol)) parsed.rol = 'operador_sucursal';
    return parsed;
  } catch {
    return null;
  }
}

/** Obtiene la sesión del operador desde las cookies (server). */
export async function getOperadorSession(): Promise<OperadorSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifyAndDecode(cookie);
}

/** Verifica el valor de la cookie (para middleware que recibe request). */
export function getOperadorSessionFromCookieValue(cookieValue: string | undefined): OperadorSession | null {
  if (!cookieValue) return null;
  return verifyAndDecode(cookieValue);
}

export const OPERADOR_COOKIE_NAME = COOKIE_NAME;
