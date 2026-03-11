const COOKIE_NAME = 'operador_session';

/**
 * Comprueba solo el formato de la cookie de sesión (sin verificar firma).
 * Este módulo es seguro para usarse en el Edge Runtime (no usa crypto de Node).
 */
export function hasValidSessionFormat(cookieValue: string | undefined): boolean {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const parts = cookieValue.split('.');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

export const OPERADOR_COOKIE_NAME = COOKIE_NAME;

