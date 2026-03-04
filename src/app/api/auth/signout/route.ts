import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('sucursal_id');
  cookieStore.delete('sucursal_nombre');
  cookieStore.delete('sucursal_codigo');
  return NextResponse.json({ ok: true });
}
