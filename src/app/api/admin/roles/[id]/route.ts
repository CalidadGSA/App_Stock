import { NextRequest, NextResponse } from 'next/server';
import {
  canManageSuperadminRole,
  requireRolesManageRbac,
} from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import type { RolOperador } from '@/lib/auth/roles';

type RouteCtx = { params: Promise<{ id: string }> };

async function getRoleId(params: Promise<{ id: string }>) {
  const { id } = await params;
  const roleId = parseInt(id, 10);
  if (Number.isNaN(roleId)) return null;
  return roleId;
}

/** GET — detalle de rol con permisos */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  const roleId = await getRoleId(ctx.params);
  if (!roleId) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const admin = await createAdminClient();
  const { data: role, error } = await admin
    .from('app_roles')
    .select('id, codigo, nombre, descripcion, rol_legacy, es_sistema, activo')
    .eq('id', roleId)
    .maybeSingle();

  if (error || !role) {
    return NextResponse.json({ error: 'Rol no encontrado' }, { status: 404 });
  }

  const { data: perms } = await admin
    .from('app_role_permissions')
    .select('permission_codigo')
    .eq('role_id', roleId);

  return NextResponse.json({
    data: {
      ...role,
      permissions: (perms ?? []).map((p) => p.permission_codigo as string),
    },
  });
}

/** PATCH — actualizar rol y permisos */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  const roleId = await getRoleId(ctx.params);
  if (!roleId) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  let body: {
    nombre?: string;
    descripcion?: string;
    activo?: boolean;
    permissions?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data: role, error: roleErr } = await admin
    .from('app_roles')
    .select('id, codigo, es_sistema')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr || !role) {
    return NextResponse.json({ error: 'Rol no encontrado' }, { status: 404 });
  }

  if (role.codigo === 'superadmin' && !canManageSuperadminRole(guard.ctx)) {
    return NextResponse.json({ error: 'Solo superadmin puede modificar este rol' }, { status: 403 });
  }

  const patch: Record<string, unknown> = { actualizado: new Date().toISOString() };

  if (typeof body.nombre === 'string' && body.nombre.trim()) {
    patch.nombre = body.nombre.trim();
  }
  if (typeof body.descripcion === 'string') {
    patch.descripcion = body.descripcion.trim() || null;
  }
  if (typeof body.activo === 'boolean' && !role.es_sistema) {
    patch.activo = body.activo;
  }

  if (Object.keys(patch).length > 1) {
    const { error: updErr } = await admin.from('app_roles').update(patch).eq('id', roleId);
    if (updErr) {
      return NextResponse.json({ error: 'Error al actualizar el rol' }, { status: 500 });
    }
  }

  if (Array.isArray(body.permissions)) {
    const permissions = [...new Set(body.permissions.filter((p) => typeof p === 'string'))];

    if (role.codigo === 'superadmin' && !canManageSuperadminRole(guard.ctx)) {
      return NextResponse.json({ error: 'Sin permisos para editar permisos de superadmin' }, { status: 403 });
    }

    await admin.from('app_role_permissions').delete().eq('role_id', roleId);

    if (permissions.length > 0) {
      const { error: insErr } = await admin.from('app_role_permissions').insert(
        permissions.map((permission_codigo) => ({ role_id: roleId, permission_codigo })),
      );
      if (insErr) {
        return NextResponse.json({ error: 'Error al guardar permisos' }, { status: 500 });
      }
    }

    if (role.es_sistema) {
      const rolLegacy = role.codigo as RolOperador;
      if (['superadmin', 'admin', 'operador_sucursal'].includes(rolLegacy)) {
        await admin
          .from('operadores')
          .update({ rol: rolLegacy })
          .eq('app_role_id', roleId);
      }
    }
  }

  return GET(request, ctx);
}

/** DELETE — eliminar rol personalizado */
export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  const roleId = await getRoleId(ctx.params);
  if (!roleId) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const admin = await createAdminClient();
  const { data: role } = await admin
    .from('app_roles')
    .select('id, codigo, es_sistema')
    .eq('id', roleId)
    .maybeSingle();

  if (!role) {
    return NextResponse.json({ error: 'Rol no encontrado' }, { status: 404 });
  }

  if (role.es_sistema) {
    return NextResponse.json({ error: 'No se pueden eliminar roles de sistema' }, { status: 400 });
  }

  const { count } = await admin
    .from('operadores')
    .select('idoperador', { count: 'exact', head: true })
    .eq('app_role_id', roleId)
    .eq('activo', 'S');

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Hay operadores asignados a este rol. Reasignálos antes de eliminar.' },
      { status: 409 },
    );
  }

  const { error } = await admin.from('app_roles').delete().eq('id', roleId);
  if (error) {
    return NextResponse.json({ error: 'Error al eliminar el rol' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
