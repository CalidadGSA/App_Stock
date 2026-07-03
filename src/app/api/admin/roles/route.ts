import { NextRequest, NextResponse } from 'next/server';
import {
  canManageSuperadminRole,
  requireRolesManageRbac,
  type AppRoleRow,
} from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import type { RolOperador } from '@/lib/auth/roles';

function slugCodigo(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 48);
}

/** GET — listado de roles con conteos */
export async function GET() {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  const admin = await createAdminClient();
  const { data: roles, error } = await admin
    .from('app_roles')
    .select('id, codigo, nombre, descripcion, rol_legacy, es_sistema, activo, creado, actualizado')
    .order('es_sistema', { ascending: false })
    .order('nombre', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Error al cargar roles' }, { status: 500 });
  }

  const roleIds = (roles ?? []).map((r) => r.id as number);
  const permCounts = new Map<number, number>();
  const opCounts = new Map<number, number>();

  if (roleIds.length > 0) {
    const { data: rp } = await admin
      .from('app_role_permissions')
      .select('role_id')
      .in('role_id', roleIds);
    for (const row of rp ?? []) {
      const id = row.role_id as number;
      permCounts.set(id, (permCounts.get(id) ?? 0) + 1);
    }

    const { data: ops } = await admin
      .from('operadores')
      .select('app_role_id')
      .eq('activo', 'S')
      .in('app_role_id', roleIds);
    for (const row of ops ?? []) {
      const id = row.app_role_id as number;
      if (id) opCounts.set(id, (opCounts.get(id) ?? 0) + 1);
    }
  }

  const list = (roles ?? []).map((r) => ({
    id: r.id as number,
    codigo: r.codigo as string,
    nombre: r.nombre as string,
    descripcion: (r.descripcion as string) ?? null,
    rol_legacy: r.rol_legacy as RolOperador,
    es_sistema: Boolean(r.es_sistema),
    activo: Boolean(r.activo),
    permisos_count: permCounts.get(r.id as number) ?? 0,
    operadores_count: opCounts.get(r.id as number) ?? 0,
  }));

  return NextResponse.json({ data: list });
}

/** POST — crear rol personalizado */
export async function POST(request: NextRequest) {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  let body: {
    codigo?: string;
    nombre?: string;
    descripcion?: string;
    rol_legacy?: RolOperador;
    permissions?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 });
  }

  let codigo = typeof body.codigo === 'string' ? slugCodigo(body.codigo) : slugCodigo(nombre);
  if (!codigo) codigo = `rol_${Date.now()}`;

  const reservados = ['superadmin', 'admin', 'operador_sucursal'];
  if (reservados.includes(codigo)) {
    return NextResponse.json({ error: 'Código reservado para rol de sistema' }, { status: 400 });
  }

  const rolLegacy: RolOperador =
    body.rol_legacy === 'admin' || body.rol_legacy === 'superadmin'
      ? 'operador_sucursal'
      : body.rol_legacy === 'operador_sucursal'
        ? 'operador_sucursal'
        : 'operador_sucursal';

  const permissions = Array.isArray(body.permissions)
    ? [...new Set(body.permissions.filter((p) => typeof p === 'string' && p.length > 0))]
    : [];

  const admin = await createAdminClient();

  const { data: existing } = await admin.from('app_roles').select('id').eq('codigo', codigo).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un rol con ese código' }, { status: 409 });
  }

  const { data: role, error } = await admin
    .from('app_roles')
    .insert({
      codigo,
      nombre,
      descripcion: typeof body.descripcion === 'string' ? body.descripcion.trim() || null : null,
      rol_legacy: rolLegacy,
      es_sistema: false,
      activo: true,
    })
    .select('id, codigo, nombre, descripcion, rol_legacy, es_sistema, activo')
    .single();

  if (error || !role) {
    return NextResponse.json({ error: 'Error al crear el rol' }, { status: 500 });
  }

  if (permissions.length > 0) {
    await admin.from('app_role_permissions').insert(
      permissions.map((permission_codigo) => ({
        role_id: role.id,
        permission_codigo,
      })),
    );
  }

  return NextResponse.json({ data: role as AppRoleRow }, { status: 201 });
}
