'use client';

import { useEffect } from 'react';

const REDIRECT_PATH = '/api/auth/session-expired';

function shouldIgnoreAuthRedirect(input: RequestInfo | URL): boolean {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  let pathname = raw;
  try {
    pathname = new URL(raw, window.location.origin).pathname;
  } catch {
    // relative path
  }

  if (pathname.startsWith('/api/auth/login')) return true;
  if (pathname.startsWith('/api/auth/sucursales')) return true;
  if (/^\/api\/sucursales\/[^/]+\/validar\/?$/.test(pathname)) return true;
  return false;
}

function isUnauthenticatedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'string') return false;
  const normalized = error.trim().toLowerCase();
  return normalized === 'no autenticado' || normalized.includes('no autenticado');
}

/**
 * Si una API responde 401 "No autenticado", limpia sesión y manda al login.
 * Evita que el usuario se quede mirando el error sin saber qué hacer.
 */
export default function AuthSessionRedirect() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as Window & { __gsaAuthFetchPatched?: boolean };
    if (w.__gsaAuthFetchPatched) return;
    w.__gsaAuthFetchPatched = true;

    const originalFetch = window.fetch.bind(window);
    let redirecting = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);

      if (response.status !== 401 || shouldIgnoreAuthRedirect(input) || redirecting) {
        return response;
      }

      try {
        const payload = await response.clone().json();
        if (!isUnauthenticatedPayload(payload)) {
          return response;
        }
      } catch {
        return response;
      }

      redirecting = true;
      window.location.href = REDIRECT_PATH;
      return response;
    };

    return () => {
      // Mantener el patch: AppShell puede remontar; no restaurar fetch original.
    };
  }, []);

  return null;
}
