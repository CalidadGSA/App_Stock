import type { NextRequest } from 'next/server';

/**
 * URL absoluta con el dominio que ve el navegador.
 *
 * En producción Next corre detrás de un proxy (nginx → localhost:PORT), y `request.nextUrl`
 * trae el host interno: un redirect armado con él manda al usuario a `localhost:3005`.
 * Se usa en este orden: cabeceras del proxy, `Host` si no es loopback y, como último
 * recurso en producción, `NEXT_PUBLIC_APP_URL`.
 * Sin dependencias de Node: también corre en el middleware.
 */
export function urlPublica(request: NextRequest, pathname: string): URL {
  return new URL(pathname, origenPublico(request));
}

function origenPublico(request: NextRequest): string {
  const primerValor = (h: string | null) => (h ?? '').split(',')[0]?.trim() ?? '';
  const proto = primerValor(request.headers.get('x-forwarded-proto'));
  const forwardedHost = primerValor(request.headers.get('x-forwarded-host'));
  const host = primerValor(request.headers.get('host'));

  const hostPublico = [forwardedHost, host].find((h) => h && !esLoopback(h));
  if (hostPublico) {
    const protocolo =
      proto === 'http' || proto === 'https' ? proto : request.nextUrl.protocol.replace(':', '');
    return `${protocolo}://${hostPublico}`;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (process.env.NODE_ENV === 'production' && appUrl) {
    try {
      return new URL(appUrl).origin;
    } catch {
      // NEXT_PUBLIC_APP_URL mal formada: se queda con el host del request.
    }
  }

  return request.nextUrl.origin;
}

function esLoopback(host: string): boolean {
  const nombre = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return nombre === 'localhost' || nombre === '127.0.0.1' || nombre === '::1' || nombre === '0.0.0.0';
}
