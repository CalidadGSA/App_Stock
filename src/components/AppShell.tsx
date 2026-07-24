'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import AppSidebar from '@/components/AppSidebar';
import AuthSessionRedirect from '@/components/AuthSessionRedirect';
import { AppNotificationProvider } from '@/components/notifications/AppNotificationProvider';
import type { RolOperador } from '@/lib/auth/roles';
import { shouldHideAppNav } from '@/lib/navigation/app-nav';

interface AppShellProps {
  children: React.ReactNode;
  rol: RolOperador;
  permissions: string[];
  nombreUsuario: string;
  nombreSucursal: string;
  codigoSucursal: string;
}

export default function AppShell({
  children,
  rol,
  permissions,
  nombreUsuario,
  nombreSucursal,
  codigoSucursal,
}: AppShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hideNav = shouldHideAppNav(pathname);

  return (
    <AppNotificationProvider>
      <AuthSessionRedirect />
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <Navbar
          nombreUsuario={nombreUsuario}
          nombreSucursal={nombreSucursal}
          codigoSucursal={codigoSucursal}
          rol={rol}
          permissions={permissions}
          onOpenSidebar={() => setSidebarOpen(true)}
          showSidebarToggle={!hideNav}
        />
        <div className="flex min-h-0 flex-1">
          {!hideNav && (
            <AppSidebar
              rol={rol}
              permissions={permissions}
              nombreUsuario={nombreUsuario}
              nombreSucursal={nombreSucursal}
              mobileOpen={sidebarOpen}
              onMobileClose={() => setSidebarOpen(false)}
            />
          )}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto w-full bg-gray-50 px-3 py-4 text-gray-900 sm:px-4 lg:px-4 lg:py-5 dark:bg-gray-950 dark:text-gray-100">
            {children}
          </main>
        </div>
      </div>
    </AppNotificationProvider>
  );
}
