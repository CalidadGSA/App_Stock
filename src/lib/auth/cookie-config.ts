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

export const AUTH_COOKIE_NAMES = [
  'operador_session',
  'sucursal_id',
  'sucursal_nombre',
  'sucursal_codigo',
  CAMBIO_SUCURSAL_COOKIE,
] as const;
