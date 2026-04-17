import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { isAdminLikeRole } from '@/lib/auth/roles';
import {
  inferirTipoControlInventario,
  nombreTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST /api/inventario/ocasional - crear inventario ocasional (admin y operadores) */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  let body: { motivo?: string; confirm_override?: boolean } = {};
  try {
    body = (await request.json()) as { motivo?: string; confirm_override?: boolean };
  } catch {
    // motivo obligatorio
  }

  const admin = await createAdminClient();
  const esAdmin = isAdminLikeRole(operador.rol);
  const tipoObjetivo =
    esAdmin ? 'ocasional_auditoria' : 'ocasional_sucursal';

  const { data: controlesAbiertos, error: abiertosError } = await admin
    .from('controles_inventario')
    .select('id, origen, tipo, categoria_macro, descripcion')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'en_progreso');

  if (abiertosError) {
    return NextResponse.json({ error: abiertosError.message }, { status: 500 });
  }

  const controlAbiertoMismoTipo = (controlesAbiertos ?? []).find(
    (control) => inferirTipoControlInventario(control) === tipoObjetivo
  );

  if (controlAbiertoMismoTipo) {
    const warning = `Ya hay un ${nombreTipoControlInventario(tipoObjetivo)} abierto. ¿Querés crearlo de todas formas?`;

    if (body.confirm_override !== true) {
      return NextResponse.json(
        {
          error: warning,
          warning,
          requires_confirmation: true,
        },
        { status: 409 }
      );
    }
  }

  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (!motivo) {
    return NextResponse.json({ error: 'El motivo es obligatorio' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: esAdmin ? 'Auditoria' : 'Sucursal',
      tipo: esAdmin ? 'ocasional_auditoria' : 'ocasional_sucursal',
      descripcion: motivo,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Error al crear inventario ocasional' },
      { status: 500 }
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}

