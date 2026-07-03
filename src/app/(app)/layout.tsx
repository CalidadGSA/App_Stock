import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import AppShell from '@/components/AppShell';
import MaintenanceGuard from '@/components/MaintenanceGuard';
import { getOperadorSession } from '@/lib/auth/session';
import { getOperadorRbacContext, permissionsToArray } from '@/lib/auth/rbac';
import type { RolOperador } from '@/lib/auth/roles';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const operador = await getOperadorSession();
  if (!operador) redirect('/login');

  const rbacCtx = await getOperadorRbacContext();
  const permissions = rbacCtx ? permissionsToArray(rbacCtx) : [];

  let sucursalNombre = '';
  let sucursalCodigo = '';
  try {
    const cookieStore = await cookies();
    sucursalNombre = cookieStore.get('sucursal_nombre')?.value ?? '';
    sucursalCodigo = cookieStore.get('sucursal_codigo')?.value ?? '';
  } catch {
    // Ignorar si cookies fallan
  }

  const rol = (rbacCtx?.operador.rol ?? operador.rol ?? 'operador_sucursal') as RolOperador;

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
