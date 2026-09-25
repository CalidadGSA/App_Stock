/** Duración de la cookie de sesión del operador (7 días). */
export const OPERADOR_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

/**
 * Duración de las cookies de sucursal seleccionada.
 * Antes: 12 h (provocaba reenvío a /sucursal con sesión de operador aún válida).
 */
export const SUCURSAL_SESSION_MAX_AGE_SEC = OPERADOR_SESSION_MAX_AGE_SEC;

/** Cookie breve tras "Cambiar sucursal" (permite /sucursal sin cookie de sucursal). */
export const CAMBIO_SUCURSAL_COOKIE = 'cambio_sucursal';
export const CAMBIO_SUCURSAL_MAX_AGE_SEC = 60 * 15;

/**
 * Sucursal activa: un solo valor firmado (HMAC) atado al operador; reemplaza a las viejas
 * cookies `sucursal_id` / `sucursal_nombre` / `sucursal_codigo` / `sucursal_es_drogueria`
 * en texto plano, que cualquiera podía editar desde DevTools para ver otra sucursal.
 */
export const SUCURSAL_COOKIE_NAME = 'sucursal_session';

/** Nombres viejos (texto plano): solo se limpian, ya no se leen ni se escriben. */
export const LEGACY_SUCURSAL_COOKIE_NAMES = [
  'sucursal_id',
  'sucursal_nombre',
  'sucursal_codigo',
  'sucursal_es_drogueria',
] as const;

export const AUTH_COOKIE_NAMES = [
  'operador_session',
  SUCURSAL_COOKIE_NAME,
  ...LEGACY_SUCURSAL_COOKIE_NAMES,
  CAMBIO_SUCURSAL_COOKIE,
] as const;

/** `secure` solo en producción (en dev se usa http://localhost). Seguro para Edge. */
export function cookieSecureFlag(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Atributos comunes de todas las cookies de auth (httpOnly + sameSite lax + secure en prod). */
export function authCookieOptions(maxAgeSec: number): {
  httpOnly: true;
  path: '/';
  maxAge: number;
  sameSite: 'lax';
  secure: boolean;
} {
  return {
    httpOnly: true,
    path: '/',
    maxAge: maxAgeSec,
    sameSite: 'lax',
    secure: cookieSecureFlag(),
  };
}
