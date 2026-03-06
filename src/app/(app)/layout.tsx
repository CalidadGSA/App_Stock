import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Navbar from '@/components/Navbar';
import { getOperadorSession } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const operador = await getOperadorSession();
  if (!operador) redirect('/login');

  let sucursalNombre = '';
  let sucursalCodigo = '';
  try {
    const cookieStore = await cookies();
    sucursalNombre = cookieStore.get('sucursal_nombre')?.value ?? '';
    sucursalCodigo = cookieStore.get('sucursal_codigo')?.value ?? '';
  } catch {
    // Ignorar si cookies fallan
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        nombreUsuario={operador.nombrecompleto}
        nombreSucursal={sucursalNombre}
        codigoSucursal={sucursalCodigo}
      />
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
