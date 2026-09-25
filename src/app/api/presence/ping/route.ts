import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';

function nombreNoVacio(...candidatos: Array<string | null | undefined>): string | null {
  for (const c of candidatos) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  return null;
}

/** POST /api/presence/ping — marca al operador autenticado como activo. */
export async function POST() {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const idoperador = Number(operador.idoperador);
  if (!Number.isFinite(idoperador)) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const now = new Date().toISOString();

  // Fuente de verdad: tabla operadores (la cookie puede traer nombrecompleto vacío).
  const { data: rowOp, error: opError } = await admin
    .from('operadores')
    .select('nombrecompleto, operador')
    .eq('idoperador', idoperador)
    .maybeSingle();

  if (opError) {
    console.error('presence ping operadores:', opError.message);
  }

  const nombrecompleto = nombreNoVacio(
    rowOp?.nombrecompleto,
    rowOp?.operador,
    operador.nombrecompleto,
    operador.operador
  );

  // No mandar nombrecompleto:null — eso pisa un nombre ya guardado.
  const row: {
    idoperador: number;
    last_seen_at: string;
    updated_at: string;
    nombrecompleto?: string;
  } = {
    idoperador,
    last_seen_at: now,
    updated_at: now,
  };
  if (nombrecompleto) {
    row.nombrecompleto = nombrecompleto;
  }

  const { error } = await admin.from('operador_presencia').upsert(row, {
    onConflict: 'idoperador',
  });

  if (error) {
    // Tabla aún no migrada: no romper la app.
    if (String(error.message ?? '').includes('operador_presencia')) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    console.error('presence ping:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, at: now, nombrecompleto });
}
