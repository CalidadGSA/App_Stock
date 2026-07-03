'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import AppSidebar from '@/components/AppSidebar';
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
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
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
              nombreSucursal={nombreSucursal}
              mobileOpen={sidebarOpen}
              onMobileClose={() => setSidebarOpen(false)}
            />
          )}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto w-full px-3 py-4 sm:px-4 lg:px-4 lg:py-5">
            {children}
          </main>
        </div>
      </div>
    </AppNotificationProvider>
  );
}
