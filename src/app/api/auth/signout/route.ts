import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAMES } from '@/lib/auth/cookie-config';
import { OPERADOR_COOKIE_NAME } from '@/lib/auth/session';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(OPERADOR_COOKIE_NAME);
  for (const name of AUTH_COOKIE_NAMES) {
    cookieStore.delete(name);
  }
  return NextResponse.json({ ok: true });
}
