import { getOperadorSession } from '@/lib/auth/session';
import { getOperadorRbacContext, permissionsToArray } from '@/lib/auth/rbac';
import type { RolOperador } from '@/lib/auth/roles';
import ManualBookClient from '@/components/manual/ManualBookClient';

export const metadata = {
  title: 'Manual de usuario | Gestión Stock',
  description: 'Guía de uso según tu rol en la aplicación',
};

export default async function ManualPage() {
  const operador = await getOperadorSession();
  const rbac = await getOperadorRbacContext();
  const rol = (rbac?.operador.rol ?? operador?.rol ?? 'operador_sucursal') as RolOperador;
  const permissions = rbac ? permissionsToArray(rbac) : [];

  return <ManualBookClient rol={rol} permissions={permissions} />;
}
