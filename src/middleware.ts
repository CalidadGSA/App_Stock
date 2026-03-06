import { NextResponse, type NextRequest } from 'next/server';
import { hasValidSessionFormat, OPERADOR_COOKIE_NAME } from '@/lib/auth/session';

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

  // Sin sesión operador → redirigir al login
  if (!hasSession && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Con sesión → no mostrar login; si ya tiene sucursal, ir al dashboard
  if (hasSession && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = request.cookies.get('sucursal_id')?.value ? '/dashboard' : '/sucursal';
    return NextResponse.redirect(url);
  }

  // Con sesión pero sin sucursal seleccionada → redirigir a selección
  if (hasSession && pathname !== '/sucursal') {
    const sucursalId = request.cookies.get('sucursal_id');
    if (!sucursalId?.value) {
      const url = request.nextUrl.clone();
      url.pathname = '/sucursal';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
