import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OPERADOR_COOKIE_NAME } from '@/lib/auth/session';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(OPERADOR_COOKIE_NAME);
  cookieStore.delete('sucursal_id');
  cookieStore.delete('sucursal_nombre');
  cookieStore.delete('sucursal_codigo');
  return NextResponse.json({ ok: true });
}
