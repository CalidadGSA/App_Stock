import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAMES, cookieSecureFlag } from '@/lib/auth/cookie-config';
import { OPERADOR_COOKIE_NAME } from '@/lib/auth/session';

export async function POST() {
  const cookieStore = await cookies();
  const secure = cookieSecureFlag();
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
  return NextResponse.json({ ok: true });
}
