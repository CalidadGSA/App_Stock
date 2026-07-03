import { NextRequest, NextResponse } from 'next/server';
import { canManageSuperadminRole, requireRolesManageRbac } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import type { RolOperador } from '@/lib/auth/roles';

type RouteCtx = { params: Promise<{ id: string }> };

/** PATCH — asignar app_role_id a un operador */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idoperador = parseInt(id, 10);
  if (Number.isNaN(idoperador)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  let body: { app_role_id?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (body.app_role_id !== null && body.app_role_id !== undefined) {
    if (typeof body.app_role_id !== 'number' || Number.isNaN(body.app_role_id)) {
      return NextResponse.json({ error: 'app_role_id inválido' }, { status: 400 });
    }
  }

  const admin = await createAdminClient();

  const { data: operador } = await admin
    .from('operadores')
    .select('idoperador, operador, rol')
    .eq('idoperador', idoperador)
    .maybeSingle();

  if (!operador) {
    return NextResponse.json({ error: 'Operador no encontrado' }, { status: 404 });
  }

  if (
    (operador.rol === 'superadmin' || operador.operador === 'SUPERADMIN') &&
    !canManageSuperadminRole(guard.ctx)
  ) {
    return NextResponse.json({ error: 'Sin permisos para modificar superadmin' }, { status: 403 });
  }

  let rolLegacy: RolOperador = operador.rol as RolOperador;
  let appRoleId: number | null = body.app_role_id ?? null;

  if (appRoleId !== null) {
    const { data: role } = await admin
      .from('app_roles')
      .select('id, codigo, rol_legacy, activo, es_sistema')
      .eq('id', appRoleId)
      .maybeSingle();

    if (!role || !role.activo) {
      return NextResponse.json({ error: 'Rol no encontrado o inactivo' }, { status: 404 });
    }

    if (role.codigo === 'superadmin' && !canManageSuperadminRole(guard.ctx)) {
      return NextResponse.json({ error: 'Solo superadmin puede asignar ese rol' }, { status: 403 });
    }

    rolLegacy = role.rol_legacy as RolOperador;
  } else {
    appRoleId = null;
  }

  const { error } = await admin
    .from('operadores')
    .update({
      app_role_id: appRoleId,
      rol: rolLegacy,
      actualizado: new Date().toISOString(),
    })
    .eq('idoperador', idoperador);

  if (error) {
    return NextResponse.json({ error: 'Error al actualizar operador' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    idoperador,
    app_role_id: appRoleId,
    rol: rolLegacy,
  });
}
