'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, LogOut, Menu, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import type { RolOperador } from '@/lib/auth/roles';
import { clientHasAdminAccess } from '@/lib/auth/permissions-client';
import { shouldHideAppNav } from '@/lib/navigation/app-nav';

interface NavbarProps {
  nombreUsuario: string;
  nombreSucursal: string;
  codigoSucursal: string;
  rol: RolOperador;
  permissions: string[];
  onOpenSidebar?: () => void;
  showSidebarToggle?: boolean;
}

export default function Navbar({
  nombreUsuario,
  nombreSucursal,
  codigoSucursal,
  rol,
  permissions,
  onOpenSidebar,
  showSidebarToggle = true,
}: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [modoOscuro, setModoOscuro] = useState(false);
  const ocultarAccionesOperativas = shouldHideAppNav(pathname);

  useEffect(() => {
    const root = document.documentElement;
    const guardado = localStorage.getItem('theme');
    if (guardado === 'dark') {
      root.classList.add('dark');
      setModoOscuro(true);
      return;
    }
    if (guardado === 'light') {
      root.classList.remove('dark');
      setModoOscuro(false);
      return;
    }
    const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefiereOscuro);
    setModoOscuro(prefiereOscuro);
  }, []);

  function toggleModoOscuro() {
    const root = document.documentElement;
    const actualmenteOscuro = root.classList.contains('dark');
    const siguiente = !actualmenteOscuro;
    setModoOscuro(siguiente);
    root.classList.toggle('dark', siguiente);
    localStorage.setItem('theme', siguiente ? 'dark' : 'light');
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function handleCambiarSucursal() {
    await fetch('/api/auth/signout-sucursal', { method: 'POST' });
    router.push('/sucursal');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2 shrink-0">
          {showSidebarToggle && onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 lg:hidden dark:text-gray-300 dark:hover:bg-gray-800"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 shrink-0"
            aria-label="Ir al dashboard"
          >
            <img src="/logogsa800.png" alt="Logo" className="h-8 w-8 object-contain rounded-lg" />
            <p className="hidden sm:block text-sm font-semibold text-gray-900 leading-tight dark:text-gray-100">
              Gestión Stock
            </p>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
          <div className="hidden md:flex items-center gap-4 shrink-0">
            <span className="text-sm text-gray-600 truncate max-w-[180px] dark:text-gray-400" title={nombreSucursal}>
              {nombreSucursal || codigoSucursal}
            </span>
            <span
              className="text-sm font-medium text-gray-800 truncate max-w-[160px] dark:text-gray-200"
              title={nombreUsuario}
            >
              {nombreUsuario}
            </span>
          </div>

          {clientHasAdminAccess(permissions, rol) && !ocultarAccionesOperativas && (
            <button
              type="button"
              onClick={handleCambiarSucursal}
              title="Cambiar sucursal"
              aria-label="Cambiar sucursal"
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors shrink-0 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:px-2.5"
            >
              <Building2 className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Cambiar sucursal</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleModoOscuro}
            className="inline-flex items-center justify-center rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors shrink-0 dark:text-gray-300 dark:hover:bg-gray-800"
            title={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
            aria-label={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
          >
            {modoOscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {!ocultarAccionesOperativas && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors shrink-0 dark:text-gray-300 dark:hover:bg-red-950 dark:hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{loggingOut ? 'Saliendo...' : 'Salir'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
