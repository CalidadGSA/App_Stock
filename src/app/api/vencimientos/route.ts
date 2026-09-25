import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { listarOperadoresDeControlesVencimientos } from '@/lib/controles-operadores-opciones';
import { NextRequest, NextResponse } from 'next/server';
import { parsePaginationParams } from '@/lib/api/pagination';
import { parseYmdCalendario, rangoFechasArgentinaIso } from '@/lib/utils';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';

/** GET /api/vencimientos - listar controles de vencimientos (con paginación y filtros) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sucursalId = await getSucursalIdSesion();
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const { searchParams } = new URL(request.url);
  // Valida page/pageSize (NaN o tamaños enormes rompían `.range()` o traían toda la tabla).
  const { page, pageSize } = parsePaginationParams(searchParams);
  // Fechas inválidas se ignoran (antes rompían la consulta con 500).
  const desde = parseYmdCalendario(searchParams.get('desde')) ? searchParams.get('desde') : null;
  const hasta = parseYmdCalendario(searchParams.get('hasta')) ? searchParams.get('hasta') : null;
  const estado = searchParams.get('estado');
  const operadorRaw = String(searchParams.get('operador') ?? '').trim();
  const operadorId = operadorRaw ? parseInt(operadorRaw, 10) : NaN;

  let query = admin
    .from('controles_vencimientos')
    .select('*, sucursales(nombrefantasia), operadores(nombrecompleto)', { count: 'exact' })
    .eq('sucursal_id', sucursalId);

  // Límites en días calendario Argentina (fecha_inicio es timestamptz).
  if (desde) {
    query = query.gte('fecha_inicio', rangoFechasArgentinaIso(desde, desde).desdeIso);
  }
  if (hasta) {
    query = query.lte('fecha_inicio', rangoFechasArgentinaIso(hasta, hasta).hastaIso);
  }
  if (estado === 'en_progreso' || estado === 'cerrado') {
    query = query.eq('estado', estado);
  }
  if (Number.isFinite(operadorId) && operadorId > 0) {
    query = query.eq('usuario_id', operadorId);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const [{ data, error, count }, operadores] = await Promise.all([
    query.order('created_at', { ascending: false }).range(from, to),
    listarOperadoresDeControlesVencimientos(admin, sucursalId),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    data: data ?? [],
    total: count ?? data?.length ?? 0,
    page,
    pageSize,
    operadores,
  });
}

export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sucursalId = await getSucursalIdSesion();
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  type CrearBody = { observaciones?: string; categoria_macro?: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null };
  let body: CrearBody;
  try {
    body = (await request.json()) as CrearBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const categoriaMacro = body.categoria_macro ?? null;
  if (categoriaMacro && !['FARMA', 'BIENESTAR', 'PSICOTROPICOS'].includes(categoriaMacro)) {
    return NextResponse.json({ error: 'Categoría macro no válida' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_vencimientos')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      observaciones: body.observaciones ?? null,
      categoria_macro: categoriaMacro,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
