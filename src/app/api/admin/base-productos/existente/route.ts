import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { leerBaseExistente } from '@/lib/inventario/generar-base/job';
import type { Cuatrimestre } from '@/lib/inventario/trimestre-periodo';

export const dynamic = 'force-dynamic';

/** GET — qué hay cargado para ese trimestre, para avisar antes de reemplazar. */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.base_productos');
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const anio = Number(params.get('anio'));
  const cuatrimestre = Number(params.get('cuatrimestre'));

  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    return NextResponse.json({ error: 'Año inválido' }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(cuatrimestre)) {
    return NextResponse.json({ error: 'Trimestre inválido (1 a 4)' }, { status: 400 });
  }

  const sucursales = String(params.get('sucursales') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((s) => Number.isInteger(s) && s > 0);

  if (sucursales.length === 0) {
    return NextResponse.json({ error: 'Elegí al menos una sucursal' }, { status: 400 });
  }

  const existente = await leerBaseExistente(anio, cuatrimestre as Cuatrimestre, sucursales);
  return NextResponse.json(existente);
}
