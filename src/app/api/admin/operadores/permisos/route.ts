import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ALL_PERMISSION_CODES,
  permisosDeRolPredeterminado,
} from '@/lib/auth/permissions-catalog';

export const dynamic = 'force-dynamic';

const PERMISO = 'admin.roles_manage';

/** La migración 034 todavía no está aplicada. */
function faltaLaTabla(mensaje: string): boolean {
  return /operador_permisos|schema cache|does not exist/i.test(mensaje);
}

/**
 * GET /api/admin/operadores/permisos?idoperador=N
 * Permisos del rol del operador y los ajustes individuales que tenga cargados.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission(PERMISO);
  if (!guard.ok) return guard.response;

  const idoperador = Number(request.nextUrl.searchParams.get('idoperador'));
  if (!Number.isInteger(idoperador)) {
    return NextResponse.json({ error: 'idoperador inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data: op, error: opErr } = await admin
    .from('operadores')
    .select('idoperador, operador, nombrecompleto, rol, app_role_id, activo')
    .eq('idoperador', idoperador)
    .maybeSingle();

  if (opErr) return NextResponse.json({ error: opErr.message }, { status: 500 });
  if (!op) return NextResponse.json({ error: 'Operador no encontrado' }, { status: 404 });

  const operador = op as {
    idoperador: number;
    operador: string;
    nombrecompleto: string;
    rol: string;
    app_role_id: number | null;
    activo: string;
  };

  // Permisos que trae el rol que tiene asignado hoy.
  let delRol: string[] = [];
  if (operador.app_role_id) {
    const { data: rolePerms } = await admin
      .from('app_role_permissions')
      .select('permission_codigo')
      .eq('role_id', operador.app_role_id);
    delRol = (rolePerms ?? []).map((r) => String((r as { permission_codigo: string }).permission_codigo));
  }
  if (delRol.length === 0) delRol = permisosDeRolPredeterminado(operador.rol);

  const { data: ajustesRows, error: ajErr } = await admin
    .from('operador_permisos')
    .select('permission_codigo, concedido, motivo')
    .eq('idoperador', idoperador);

  if (ajErr && !faltaLaTabla(ajErr.message)) {
    return NextResponse.json({ error: ajErr.message }, { status: 500 });
  }

  const ajustes = (ajustesRows ?? []) as Array<{
    permission_codigo: string;
    concedido: boolean;
    motivo: string | null;
  }>;

  const efectivos = new Set(delRol);
  for (const a of ajustes) {
    if (a.concedido) efectivos.add(a.permission_codigo);
    else efectivos.delete(a.permission_codigo);
  }

  return NextResponse.json({
    operador: {
      idoperador: operador.idoperador,
      operador: operador.operador,
      nombrecompleto: operador.nombrecompleto,
      rol: operador.rol,
      activo: operador.activo === 'S',
    },
    del_rol: delRol.sort(),
    ajustes,
    efectivos: [...efectivos].sort(),
    disponible: !ajErr,
  });
}

/**
 * PUT /api/admin/operadores/permisos
 * Body: { idoperador, permiso, estado: 'rol' | 'conceder' | 'revocar', motivo? }
 * `rol` borra el ajuste y deja que mande el rol.
 */
export async function PUT(request: NextRequest) {
  const guard = await requirePermission(PERMISO);
  if (!guard.ok) return guard.response;

  let body: { idoperador?: unknown; permiso?: unknown; estado?: unknown; motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const idoperador = Number(body.idoperador);
  const permiso = String(body.permiso ?? '').trim();
  const estado = String(body.estado ?? '').trim();

  if (!Number.isInteger(idoperador)) {
    return NextResponse.json({ error: 'idoperador inválido' }, { status: 400 });
  }
  if (!ALL_PERMISSION_CODES.includes(permiso)) {
    return NextResponse.json({ error: `Permiso desconocido: ${permiso}` }, { status: 400 });
  }
  if (!['rol', 'conceder', 'revocar'].includes(estado)) {
    return NextResponse.json({ error: 'estado debe ser rol, conceder o revocar' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Al superadmin no se le pueden sacar permisos: el código le da acceso total igual, así que
  // guardar un "revocar" solo generaría confusión en la pantalla.
  const { data: op } = await admin
    .from('operadores')
    .select('rol')
    .eq('idoperador', idoperador)
    .maybeSingle();
  if (String((op as { rol?: string } | null)?.rol ?? '').toLowerCase() === 'superadmin') {
    return NextResponse.json(
      { error: 'El superadministrador tiene acceso total y no admite ajustes por permiso.' },
      { status: 400 }
    );
  }

  if (estado === 'rol') {
    const { error } = await admin
      .from('operador_permisos')
      .delete()
      .eq('idoperador', idoperador)
      .eq('permission_codigo', permiso);
    if (error) {
      const status = faltaLaTabla(error.message) ? 503 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ ok: true, estado });
  }

  const { error } = await admin.from('operador_permisos').upsert(
    {
      idoperador,
      permission_codigo: permiso,
      concedido: estado === 'conceder',
      motivo: typeof body.motivo === 'string' ? body.motivo.trim() || null : null,
      creado_por: guard.ctx.operador.idoperador,
      creado: new Date().toISOString(),
    },
    { onConflict: 'idoperador,permission_codigo' }
  );

  if (error) {
    const status = faltaLaTabla(error.message) ? 503 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true, estado });
}
