import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MaintenanceGuard from '@/components/MaintenanceGuard';
import { getOperadorRbacContext, permissionsToArray } from '@/lib/auth/rbac';
import type { RolOperador } from '@/lib/auth/roles';
import { getSucursalSession } from '@/lib/sucursales/sucursal-session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Una sola verificación de sesión + rol (valida session_version en BD).
  const rbacCtx = await getOperadorRbacContext();
  if (!rbacCtx) {
    // Ruta API que limpia cookies con los mismos atributos (evita bucle /login ↔ /dashboard).
    redirect('/api/auth/session-expired');
  }
  const operador = rbacCtx.operador;
  const permissions = permissionsToArray(rbacCtx);

  const sucursal = await getSucursalSession();
  const sucursalNombre = sucursal?.nombre ?? '';
  const sucursalCodigo = sucursal?.codigo ?? '';

  const rol = (operador.rol ?? 'operador_sucursal') as RolOperador;

  return (
    <MaintenanceGuard>
      <AppShell
        rol={rol}
        permissions={permissions}
        nombreUsuario={operador.nombrecompleto}
        nombreSucursal={sucursalNombre}
        codigoSucursal={sucursalCodigo}
      >
        {children}
      </AppShell>
    </MaintenanceGuard>
  );
}
