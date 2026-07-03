import { CAMBIO_SUCURSAL_COOKIE, SUCURSAL_SESSION_MAX_AGE_SEC } from '@/lib/auth/cookie-config';
import type { TipoControlInventario } from '@/lib/inventario/tipo-control';
import { cookies } from 'next/headers';

/** Admin puede operar auditorías integrales sin depender de la cookie de sucursal activa. */
export function esControlAdminMultiSucursal(tipo: TipoControlInventario): boolean {
  return tipo === 'auditoria_integral';
}

export function validarAccesoControlPorSucursal(params: {
  controlSucursalId: number | string;
  cookieSucursalId: string | undefined;
  esAdmin: boolean;
  tipoControl: TipoControlInventario;
}): boolean {
  const controlSid = String(params.controlSucursalId);
  const cookieSid = params.cookieSucursalId ?? '';

  if (params.esAdmin && esControlAdminMultiSucursal(params.tipoControl)) {
    return true;
  }

  return Boolean(cookieSid) && controlSid === cookieSid;
}

export function sucursalIdParaStockLegacy(params: {
  controlSucursalId: number | string;
  cookieSucursalId: string | undefined;
  esAdmin: boolean;
  tipoControl: TipoControlInventario;
}): string | null {
  if (params.esAdmin && esControlAdminMultiSucursal(params.tipoControl)) {
    return String(params.controlSucursalId);
  }
  return params.cookieSucursalId ?? null;
}

/** Alinea la cookie de sucursal con el control (stock legacy usa sucursal_id de cookie). */
export async function sincronizarCookieSucursal(
  sucursalId: number | string,
  nombreSucursal: string
): Promise<void> {
  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    path: '/',
    maxAge: SUCURSAL_SESSION_MAX_AGE_SEC,
    sameSite: 'lax' as const,
  };
  const sid = String(sucursalId);
  cookieStore.set('sucursal_id', sid, opts);
  cookieStore.set('sucursal_nombre', nombreSucursal, opts);
  cookieStore.set('sucursal_codigo', sid, opts);
  cookieStore.delete(CAMBIO_SUCURSAL_COOKIE);
}
