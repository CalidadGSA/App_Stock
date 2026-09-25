import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authCookieOptions,
  CAMBIO_SUCURSAL_COOKIE,
  CAMBIO_SUCURSAL_MAX_AGE_SEC,
} from '@/lib/auth/cookie-config';

/**
 * Entra en modo "cambiar sucursal" sin borrar la sucursal activa.
 * Las cookies de sucursal se actualizan solo al validar otra en /sucursal.
 */
export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(CAMBIO_SUCURSAL_COOKIE, '1', authCookieOptions(CAMBIO_SUCURSAL_MAX_AGE_SEC));
  return NextResponse.json({ ok: true });
}
