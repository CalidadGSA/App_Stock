import { createAdminClient } from '@/lib/supabase/server';
import { createOperadorSessionCookie } from '@/lib/auth/session';
import { SUCURSAL_SESSION_MAX_AGE_SEC } from '@/lib/auth/cookie-config';
import {
  esSucursalDrogueria,
  OPERADOR_FUENTE_ONZE,
  OPERADOR_FUENTE_QUANTIO,
} from '@/lib/sucursales/drogueria';
import { setCookieSucursalEsDrogueria } from '@/lib/sucursales/sesion-drogueria';
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

type OperadorRow = {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  rol?: string | null;
  activo: string;
  app_role_id?: number | null;
};

type ResolverOperadorResult =
  | { ok: true; row: OperadorRow }
  | { ok: false; reason: 'invalid_credentials' };

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const fromHeader = xff?.split(',')[0]?.trim();
  const direct = (req as { ip?: string }).ip;
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

async function resolverOperadorLogin(
  admin: AdminClient,
  operador: string,
  codigo: number,
  esDrogueria: boolean
): Promise<ResolverOperadorResult> {
  if (esDrogueria) {
    const { data: row, error } = await admin
      .from('operadores')
      .select('idoperador, operador, nombrecompleto, rol, activo, app_role_id')
      .eq('fuente', OPERADOR_FUENTE_QUANTIO)
      .eq('operador', operador)
      .eq('codigo', codigo)
      .maybeSingle();

    if (error) {
      if (error.message?.includes('fuente')) {
        console.error('resolverOperadorLogin droguería: falta columna fuente en operadores');
        return { ok: false, reason: 'invalid_credentials' };
      }
      console.error('resolverOperadorLogin droguería:', error.message);
      return { ok: false, reason: 'invalid_credentials' };
    }

    if (row && row.activo === 'S') {
      return { ok: true, row: row as OperadorRow };
    }
    return { ok: false, reason: 'invalid_credentials' };
  }

  const { data: row, error } = await admin
    .from('operadores')
    .select('idoperador, operador, nombrecompleto, rol, activo, app_role_id')
    .eq('operador', operador)
    .eq('codigo', codigo)
    .eq('fuente', OPERADOR_FUENTE_ONZE)
    .maybeSingle();

  if (error) {
    if (error.message?.includes('fuente')) {
      const { data: legacyRow, error: legacyError } = await admin
        .from('operadores')
        .select('idoperador, operador, nombrecompleto, rol, activo, app_role_id')
        .eq('operador', operador)
        .eq('codigo', codigo)
        .maybeSingle();
      if (legacyError) {
        console.error('resolverOperadorLogin:', legacyError.message);
        return { ok: false, reason: 'invalid_credentials' };
      }
      if (legacyRow && legacyRow.activo === 'S') {
        return { ok: true, row: legacyRow as OperadorRow };
      }
      return { ok: false, reason: 'invalid_credentials' };
    }
    console.error('resolverOperadorLogin:', error.message);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (row && row.activo === 'S') {
    return { ok: true, row: row as OperadorRow };
  }

  return { ok: false, reason: 'invalid_credentials' };
}

/** POST /api/auth/login — login con operador + código; opcional sucursal + contraseña para ir directo al dashboard */
export async function POST(request: NextRequest) {
  let body: { operador?: string; codigo?: string | number; sucursal_id?: string; sucursal_password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const operadorInput = typeof body.operador === 'string' ? body.operador.trim() : '';
  const operador = operadorInput.toUpperCase();
  const codigo = typeof body.codigo === 'number' ? body.codigo : typeof body.codigo === 'string' ? parseInt(body.codigo, 10) : NaN;

  if (!operador || Number.isNaN(codigo)) {
    return NextResponse.json({ error: 'Operador y código son requeridos' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;

  const sucursalId = typeof body.sucursal_id === 'string' ? body.sucursal_id.trim() : '';
  const sucursalPassword = typeof body.sucursal_password === 'string' ? body.sucursal_password : '';

  let esDrogueria = false;
  if (sucursalId) {
    const sucursalIdNum = parseInt(sucursalId, 10);
    if (!Number.isNaN(sucursalIdNum)) {
      esDrogueria = await esSucursalDrogueria(admin, sucursalIdNum);
    }
  }

  const resolved = await resolverOperadorLogin(admin, operador, codigo, esDrogueria);

  if (!resolved.ok || resolved.row.activo !== 'S') {
    await logAuth(admin, {
      username: operador,
      sucursalNombre: null,
      ip,
      userAgent,
      success: false,
      action: esDrogueria ? 'login_invalid_credentials_quantio' : 'login_invalid_credentials',
      sessionId: null,
    });
    if (esDrogueria) {
      return NextResponse.json(
        {
          error:
            'Operador o código incorrectos. Verificá que el usuario esté sincronizado en Supabase (fuente Quantio).',
        },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: 'Operador o código incorrectos' }, { status: 401 });
  }

  const row = resolved.row;

  if (!row.app_role_id && row.rol) {
    const { data: sysRole } = await admin
      .from('app_roles')
      .select('id')
      .eq('codigo', row.rol)
      .maybeSingle();
    if (sysRole?.id) {
      await admin
        .from('operadores')
        .update({ app_role_id: sysRole.id })
        .eq('idoperador', row.idoperador);
    }
  }

  const rolSesion = (String(row.rol ?? 'operador_sucursal').toLowerCase() === 'superadmin'
    ? 'superadmin'
    : String(row.rol ?? '').toLowerCase() === 'admin'
      ? 'admin'
      : 'operador_sucursal') as 'superadmin' | 'admin' | 'operador_sucursal';

  const cookieStore = await cookies();
  const operadorCookie = createOperadorSessionCookie({
    idoperador: row.idoperador,
    operador: row.operador,
    nombrecompleto: row.nombrecompleto ?? row.operador,
    rol: rolSesion,
  });
  cookieStore.set(operadorCookie.name, operadorCookie.value, operadorCookie.options);

  let sucursalSet = false;
  let sucursalNombre: string | null = null;
  if (sucursalId && sucursalPassword) {
    const sucursalIdNum = parseInt(sucursalId, 10);
    if (!Number.isNaN(sucursalIdNum)) {
      const { data: sucursal, error: sucError } = await admin
        .from('sucursales')
        .select('*')
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

      const sucursalEsDrogueria = await esSucursalDrogueria(admin, sucursalIdNum);

      const opts = {
        httpOnly: true,
        path: '/' as const,
        maxAge: SUCURSAL_SESSION_MAX_AGE_SEC,
        sameSite: 'lax' as const,
      };
      cookieStore.set('sucursal_id', String(sucursal.sucursal), opts);
      cookieStore.set('sucursal_nombre', sucursal.nombrefantasia, opts);
      cookieStore.set('sucursal_codigo', String(sucursal.sucursal), opts);
      setCookieSucursalEsDrogueria(cookieStore, sucursalEsDrogueria, opts);
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
