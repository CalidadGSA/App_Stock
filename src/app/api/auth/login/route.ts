import { createAdminClient } from '@/lib/supabase/server';
import { createOperadorSessionCookie } from '@/lib/auth/session';
import {
  esSucursalDrogueria,
  OPERADOR_FUENTE_ONZE,
  OPERADOR_FUENTE_QUANTIO,
} from '@/lib/sucursales/drogueria';
import { setSucursalSessionCookie } from '@/lib/sucursales/sucursal-session';
import { registrarIntentoLogin, verificarRateLimitLogin } from '@/lib/auth/login-rate-limit';
import {
  upsertOperadorErpEnSupabase,
  validarOperadorOnzeLive,
  type OperadorErpValidado,
  type ValidacionErpResult,
} from '@/lib/auth/erp-operador-login';
import {
  upsertOperadorQuantioEnSupabase,
  validarOperadorQuantioLive,
  type OperadorQuantioValidado,
  type ValidacionQuantioResult,
} from '@/lib/auth/quantio-operador-login';
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
  session_version?: number | null;
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

/**
 * Valida operador + código contra el ERP correspondiente a la sucursal elegida
 * (droguería → Quantio/plexdr; resto → onze_center) y espeja el operador en Supabase.
 *
 * Si el ERP no responde se cae a `operadores` de Supabase, para que una caída de la base
 * legacy no deje a nadie afuera.
 */
async function resolverOperadorLogin(
  admin: AdminClient,
  operador: string,
  codigo: number,
  esDrogueria: boolean
): Promise<ResolverOperadorResult> {
  const fuente = esDrogueria ? OPERADOR_FUENTE_QUANTIO : OPERADOR_FUENTE_ONZE;

  const validacion: ValidacionErpResult | ValidacionQuantioResult = esDrogueria
    ? await validarOperadorQuantioLive(operador, codigo)
    : await validarOperadorOnzeLive(operador, codigo);

  if (validacion.ok && esDrogueria) {
    // El flujo Quantio ya mapea el rol desde `Administrador`.
    const op = validacion.operador as OperadorQuantioValidado;
    const { rol, app_role_id } = await upsertOperadorQuantioEnSupabase(admin, op);
    const { data: fila } = await admin
      .from('operadores')
      .select('session_version')
      .eq('idoperador', op.idoperador)
      .maybeSingle();
    return {
      ok: true,
      row: {
        idoperador: op.idoperador,
        operador: op.operador,
        nombrecompleto: op.nombrecompleto,
        rol,
        activo: 'S',
        app_role_id,
        session_version: Number(
          (fila as { session_version?: number | null } | null)?.session_version ?? 0
        ),
      },
    };
  }

  if (validacion.ok) {
    const erp = validacion.operador as OperadorErpValidado;
    const sesion = await upsertOperadorErpEnSupabase(admin, erp, fuente);
    return {
      ok: true,
      row: {
        idoperador: erp.idoperador,
        operador: erp.operador,
        nombrecompleto: erp.nombrecompleto,
        rol: sesion.rol,
        activo: 'S',
        app_role_id: sesion.app_role_id,
        session_version: sesion.session_version,
      },
    };
  }

  // Credenciales incorrectas en el ERP: no hay nada más que mirar.
  if (validacion.reason === 'invalid_credentials') {
    return { ok: false, reason: 'invalid_credentials' };
  }

  // ERP inalcanzable o sin configurar: respaldo con lo espejado en Supabase.
  console.warn(
    `[login] ERP ${fuente} no disponible (${validacion.reason}); se valida contra Supabase`
  );
  const { data: row, error } = await admin
    .from('operadores')
    .select('idoperador, operador, nombrecompleto, rol, activo, app_role_id, session_version')
    .eq('fuente', fuente)
    .eq('operador', operador)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) {
    console.error('resolverOperadorLogin (respaldo Supabase):', error.message);
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (row && row.activo === 'S') return { ok: true, row: row as OperadorRow };
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

  // Fuerza bruta: el código es numérico y corto; limitar intentos fallidos por IP y por operador.
  const limite = verificarRateLimitLogin({ ip, operador });
  if (!limite.ok) {
    await logAuth(admin, {
      username: operador,
      sucursalNombre: null,
      ip,
      userAgent,
      success: false,
      action: 'login_rate_limited',
      sessionId: null,
    });
    return NextResponse.json(
      { error: `Demasiados intentos fallidos. Esperá ${limite.retryAfterSec} segundos y volvé a intentar.` },
      { status: 429, headers: { 'Retry-After': String(limite.retryAfterSec) } }
    );
  }

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
    registrarIntentoLogin({ ip, operador, exito: false });
    await logAuth(admin, {
      username: operador,
      sucursalNombre: null,
      ip,
      userAgent,
      success: false,
      action: esDrogueria ? 'login_invalid_credentials_quantio' : 'login_invalid_credentials',
      sessionId: null,
    });
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

  const nombreSesion =
    String(row.nombrecompleto ?? '').trim() || String(row.operador ?? '').trim();

  const cookieStore = await cookies();
  const operadorCookie = createOperadorSessionCookie({
    idoperador: row.idoperador,
    operador: row.operador,
    nombrecompleto: nombreSesion,
    rol: rolSesion,
    session_version: Number(row.session_version ?? 0),
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
        registrarIntentoLogin({ ip, operador, exito: false });
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

      await setSucursalSessionCookie(
        cookieStore,
        { id: sucursal.sucursal, nombre: sucursal.nombrefantasia, esDrogueria: sucursalEsDrogueria },
        row.idoperador
      );
      sucursalNombre = sucursal.nombrefantasia;
      sucursalSet = true;
    }
  }

  registrarIntentoLogin({ ip, operador, exito: true });
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
    nombrecompleto: nombreSesion,
    sucursal_set: sucursalSet,
  });
}
