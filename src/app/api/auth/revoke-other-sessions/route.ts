import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  createOperadorSessionCookie,
  getOperadorSession,
} from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/auth/revoke-other-sessions
 * Incrementa operadores.session_version y reemite la cookie del dispositivo actual.
 * Las cookies de otros dispositivos quedan inválidas.
 */
export async function POST() {
  const session = await getOperadorSession();
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const { data: opRow, error: readError } = await admin
    .from('operadores')
    .select('session_version, activo')
    .eq('idoperador', session.idoperador)
    .maybeSingle();

  if (readError) {
    if (String(readError.message ?? '').includes('session_version')) {
      return NextResponse.json(
        {
          error:
            'Falta la columna operadores.session_version. Aplicá la migración 021_operadores_session_version.sql en Supabase.',
        },
        { status: 503 }
      );
    }
    console.error('revoke-other-sessions read:', readError.message);
    return NextResponse.json(
      { error: 'No se pudo cerrar sesiones en otros dispositivos' },
      { status: 500 }
    );
  }

  if (!opRow || String((opRow as { activo?: string }).activo ?? '') !== 'S') {
    return NextResponse.json({ error: 'Operador no encontrado o inactivo' }, { status: 403 });
  }

  const currentVersion = Number(
    (opRow as { session_version?: number | null }).session_version ?? 0
  );
  const nextVersion = (Number.isFinite(currentVersion) ? Math.floor(currentVersion) : 0) + 1;

  const { error: updateError } = await admin
    .from('operadores')
    .update({ session_version: nextVersion })
    .eq('idoperador', session.idoperador);

  if (updateError) {
    console.error('revoke-other-sessions update:', updateError.message);
    return NextResponse.json(
      { error: 'No se pudo cerrar sesiones en otros dispositivos' },
      { status: 500 }
    );
  }

  const cookieStore = await cookies();
  const operadorCookie = createOperadorSessionCookie({
    idoperador: session.idoperador,
    operador: session.operador,
    nombrecompleto: session.nombrecompleto,
    rol: session.rol,
    session_version: nextVersion,
  });
  cookieStore.set(operadorCookie.name, operadorCookie.value, operadorCookie.options);

  return NextResponse.json({
    ok: true,
    session_version: nextVersion,
    message: 'Se cerró la sesión en los demás dispositivos. Este dispositivo sigue conectado.',
  });
}
