import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Navbar from '@/components/Navbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const cookieStore = await cookies();
  const sucursalNombre = cookieStore.get('sucursal_nombre')?.value ?? '';
  const sucursalCodigo = cookieStore.get('sucursal_codigo')?.value ?? '';

  // Obtener nombre del usuario
  const { createAdminClient } = await import('@/lib/supabase/server');
  const admin = await createAdminClient();
  const { data: usuario } = await admin
    .from('usuarios')
    .select('nombre')
    .eq('id', user.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        nombreUsuario={usuario?.nombre ?? user.email ?? ''}
        nombreSucursal={sucursalNombre}
        codigoSucursal={sucursalCodigo}
      />
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
