import { createAdminClient } from '@/lib/supabase/server';
import { createOperadorSessionCookie } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type AuthLogParams = {
  username: string;
  sucursalNombre?: string | null;
  ip: string;
  userAgent: string | null;
  success: boolean;
  action: string;
  sessionId?: string | null;
};

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const fromHeader = xff?.split(',')[0]?.trim();
  const direct = (req as any).ip as string | undefined;
  const realIp = req.headers.get('x-real-ip') || undefined;
  let ip = fromHeader || direct || realIp || '';

  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

async function logAuth(admin: AdminClient, params: AuthLogParams) {
  const { username, sucursalNombre, ip, userAgent, success, action, sessionId } = params;
  const { error } = await admin.from('auth_log').insert({
    username,
    sucursal_nombre: sucursalNombre ?? null,
    ip_address: ip,
    action,
    session_id: sessionId ?? null,
    user_agent: userAgent,
    success,
  });
  if (error) {
    console.error('Error registrando en auth_log:', error);
  }
}

/** POST /api/auth/login — login con operador + código; opcional sucursal + contraseña para ir directo al dashboard */
export async function POST(request: NextRequest) {
  let body: { operador?: string; codigo?: string | number; sucursal_id?: string; sucursal_password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const operador = typeof body.operador === 'string' ? body.operador.trim() : '';
  const codigo = typeof body.codigo === 'number' ? body.codigo : typeof body.codigo === 'string' ? parseInt(body.codigo, 10) : NaN;

  if (!operador || Number.isNaN(codigo)) {
    return NextResponse.json({ error: 'Operador y código son requeridos' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  const { data: row, error } = await admin
    .from('operadores')
    .select('idoperador, operador, nombrecompleto, rol, activo')
    .eq('operador', operador)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) {
    await logAuth(admin, {
      username: operador,
      sucursalNombre: null,
      ip,
      userAgent,
      success: false,
      action: 'login_error',
      sessionId: null,
    });
    return NextResponse.json({ error: 'Error al validar credenciales' }, { status: 500 });
  }

  if (!row || row.activo !== 'S') {
    await logAuth(admin, {
      username: operador,
      sucursalNombre: null,
      ip,
      userAgent,
      success: false,
      action: 'login_invalid_credentials',
      sessionId: null,
    });
    return NextResponse.json({ error: 'Operador o código incorrectos' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const operadorCookie = createOperadorSessionCookie({
    idoperador: row.idoperador,
    operador: row.operador,
    nombrecompleto: row.nombrecompleto ?? row.operador,
    rol: row.rol ?? 'operador_sucursal',
  });
  cookieStore.set(operadorCookie.name, operadorCookie.value, operadorCookie.options);

  const sucursalId = typeof body.sucursal_id === 'string' ? body.sucursal_id.trim() : '';
  const sucursalPassword = typeof body.sucursal_password === 'string' ? body.sucursal_password : '';

  let sucursalSet = false;
  let sucursalNombre: string | null = null;
  if (sucursalId && sucursalPassword) {
    const sucursalIdNum = parseInt(sucursalId, 10);
    if (!Number.isNaN(sucursalIdNum)) {
      const { data: sucursal, error: sucError } = await admin
        .from('sucursales')
        .select('sucursal, nombrefantasia, contraseña, activa')
        .eq('sucursal', sucursalIdNum)
        .single();

      if (sucError || !sucursal) {
        await logAuth(admin, {
          username: operador,
          sucursalNombre: null,
          ip,
          userAgent,
          success: false,
          action: 'login_sucursal_not_found',
          sessionId: null,
        });
        return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 });
      }
      if (!sucursal.activa) {
        await logAuth(admin, {
          username: operador,
          sucursalNombre: sucursal.nombrefantasia,
          ip,
          userAgent,
          success: false,
          action: 'login_sucursal_inactiva',
          sessionId: null,
        });
        return NextResponse.json({ error: 'Sucursal inactiva' }, { status: 403 });
      }
      if (sucursal.contraseña !== sucursalPassword) {
        await logAuth(admin, {
          username: operador,
          sucursalNombre: sucursal.nombrefantasia,
          ip,
          userAgent,
          success: false,
          action: 'login_sucursal_password_invalid',
          sessionId: null,
        });
        return NextResponse.json({ error: 'Contraseña de sucursal incorrecta' }, { status: 401 });
      }
      const opts = { httpOnly: true, path: '/' as const, maxAge: 60 * 60 * 12, sameSite: 'lax' as const };
      cookieStore.set('sucursal_id', String(sucursal.sucursal), opts);
      cookieStore.set('sucursal_nombre', sucursal.nombrefantasia, opts);
      cookieStore.set('sucursal_codigo', String(sucursal.sucursal), opts);
      sucursalNombre = sucursal.nombrefantasia;
      sucursalSet = true;
    }
  }

  await logAuth(admin, {
    username: row.operador,
    sucursalNombre,
    ip,
    userAgent,
    success: true,
    action: 'login',
    sessionId: null,
  });

  return NextResponse.json({
    ok: true,
    operador: row.operador,
    nombrecompleto: row.nombrecompleto ?? row.operador,
    sucursal_set: sucursalSet,
  });
}
