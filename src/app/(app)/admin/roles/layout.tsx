import { redirect } from 'next/navigation';
import { getOperadorRbacContext, hasAdminAccess } from '@/lib/auth/rbac';

export default async function AdminRolesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOperadorRbacContext();
  if (!ctx || !hasAdminAccess(ctx)) {
    redirect('/dashboard');
  }
  return children;
}
