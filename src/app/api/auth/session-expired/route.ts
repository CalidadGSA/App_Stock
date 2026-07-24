import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAMES } from '@/lib/auth/cookie-config';
import { OPERADOR_COOKIE_NAME } from '@/lib/auth/session';

/**
 * GET /api/auth/session-expired
 * Limpia cookies de auth (con los mismos atributos que al setearlas) y redirige al login.
 * Evita el bucle middleware: cookie inválida → /login → /dashboard.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';

  for (const name of AUTH_COOKIE_NAMES) {
    cookieStore.set(name, '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
      secure,
    });
    cookieStore.delete(name);
  }
  cookieStore.set(OPERADOR_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
    sameSite: 'lax',
    secure,
  });
  cookieStore.delete(OPERADOR_COOKIE_NAME);

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('expirado', '1');
  return NextResponse.redirect(url);
}
