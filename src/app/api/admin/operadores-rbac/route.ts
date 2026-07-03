import { NextRequest, NextResponse } from 'next/server';

import { canManageSuperadminRole, requireRolesManageRbac } from '@/lib/auth/rbac';

import { createAdminClient } from '@/lib/supabase/server';

import type { RolOperador } from '@/lib/auth/roles';



export interface OperadorRbacRow {

  idoperador: number;

  operador: string;

  nombrecompleto: string;

  rol: RolOperador;

  activo: string;

  app_role_id: number | null;

  app_role?: {

    id: number;

    codigo: string;

    nombre: string;

    es_sistema: boolean;

  } | null;

}



/** GET — operadores con rol asignado. Query: ?role_id=N o ?role_id=sin para sin rol. */

export async function GET(request: NextRequest) {

  const guard = await requireRolesManageRbac();

  if (!guard.ok) return guard.response;



  const admin = await createAdminClient();

  const { data, error } = await admin

    .from('operadores')

    .select(`

      idoperador,

      operador,

      nombrecompleto,

      rol,

      activo,

      app_role_id,

      app_roles (

        id,

        codigo,

        nombre,

        es_sistema

      )

    `)

    .eq('activo', 'S')

    .order('operador', { ascending: true });



  if (error) {

    return NextResponse.json({ error: 'Error al cargar operadores' }, { status: 500 });

  }



  const roleIdParam = new URL(request.url).searchParams.get('role_id')?.trim() ?? '';



  const list: OperadorRbacRow[] = (data ?? []).map((row) => {

    const roleRaw = row.app_roles as

      | { id: number; codigo: string; nombre: string; es_sistema: boolean }

      | { id: number; codigo: string; nombre: string; es_sistema: boolean }[]

      | null;

    const role = Array.isArray(roleRaw) ? roleRaw[0] : roleRaw;

    return {

      idoperador: row.idoperador as number,

      operador: row.operador as string,

      nombrecompleto: row.nombrecompleto as string,

      rol: row.rol as RolOperador,

      activo: row.activo as string,

      app_role_id: (row.app_role_id as number | null) ?? null,

      app_role: role

        ? {

            id: role.id,

            codigo: role.codigo,

            nombre: role.nombre,

            es_sistema: Boolean(role.es_sistema),

          }

        : null,

    };

  });



  let filtered = list;

  if (!canManageSuperadminRole(guard.ctx)) {

    filtered = filtered.filter(

      (o) => o.rol !== 'superadmin' && o.app_role?.codigo !== 'superadmin',

    );

  }



  if (roleIdParam === 'sin') {

    filtered = filtered.filter((o) => o.app_role_id == null);

  } else if (roleIdParam) {

    const roleId = parseInt(roleIdParam, 10);

    if (!Number.isNaN(roleId)) {

      filtered = filtered.filter((o) => o.app_role_id === roleId);

    }

  }



  const payload: {

    data: OperadorRbacRow[];

    hide_superadmin?: boolean;

    filtro_role_id?: string;

  } = { data: filtered };

  if (!canManageSuperadminRole(guard.ctx)) payload.hide_superadmin = true;

  if (roleIdParam) payload.filtro_role_id = roleIdParam;



  return NextResponse.json(payload);

}

