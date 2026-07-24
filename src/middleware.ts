import { NextResponse, type NextRequest } from 'next/server';
import {
  hasValidSessionFormat,
  OPERADOR_COOKIE_NAME,
} from '@/lib/auth/sessionFormat';
import { AUTH_COOKIE_NAMES, CAMBIO_SUCURSAL_COOKIE } from '@/lib/auth/cookie-config';

function clearAuthCookies(response: NextResponse) {
  const secure = process.env.NODE_ENV === 'production';
  for (const name of AUTH_COOKIE_NAMES) {
    response.cookies.set(name, '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
      secure,
    });
    response.cookies.delete(name);
  }
  return response;
}

function redirectToLogin(request: NextRequest, opts?: { expirado?: boolean }) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.delete('expirado');
  if (opts?.expirado) url.searchParams.set('expirado', '1');
  return clearAuthCookies(NextResponse.redirect(url));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/login');
  const isApiRoute = pathname.startsWith('/api');
  const isStaticRoute = pathname.startsWith('/_next') || pathname.includes('.');

  if (isStaticRoute || isApiRoute) {
    return NextResponse.next({ request });
  }

  const operadorCookie = request.cookies.get(OPERADOR_COOKIE_NAME)?.value;
  const hasSession = hasValidSessionFormat(operadorCookie);
  const sucursalId = request.cookies.get('sucursal_id')?.value?.trim();
  const cambioSucursalVoluntario =
    request.cookies.get(CAMBIO_SUCURSAL_COOKIE)?.value === '1';

  // Cambio de sucursal (operador sigue logueado): solo si vino del botón "Cambiar sucursal"
  if (pathname === '/sucursal') {
    if (!hasSession) return redirectToLogin(request);
    if (!sucursalId && !cambioSucursalVoluntario) {
      return redirectToLogin(request, { expirado: true });
    }
    return NextResponse.next({ request });
  }

  if (!hasSession && !isAuthRoute) {
    return redirectToLogin(request);
  }

  if (hasSession && isAuthRoute) {
    // Tras sesión inválida el layout redirige con ?expirado=1 y limpia cookies;
    // no rebotar a /dashboard si aún llegara una cookie vieja en el mismo request.
    if (request.nextUrl.searchParams.get('expirado') === '1') {
      return clearAuthCookies(NextResponse.next({ request }));
    }
    if (sucursalId) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  // Operador “logueado” pero sin sucursal (cookie de sucursal vencida o borrada) → login completo
  if (hasSession && !sucursalId) {
    return redirectToLogin(request, { expirado: true });
  }

  // Salió del selector sin elegir otra: sigue con la sucursal anterior
  if (hasSession && cambioSucursalVoluntario && pathname !== '/sucursal' && sucursalId) {
    const res = NextResponse.next({ request });
    res.cookies.delete(CAMBIO_SUCURSAL_COOKIE);
    return res;
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
