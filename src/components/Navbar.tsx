'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Package, LayoutDashboard, Menu, X, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface NavbarProps {
  nombreUsuario: string;
  nombreSucursal: string;
  codigoSucursal: string;
}

export default function Navbar({ nombreUsuario, nombreSucursal, codigoSucursal }: NavbarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Limpiar cookie de sucursal
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function handleCambiarSucursal() {
    await fetch('/api/auth/signout-sucursal', { method: 'POST' });
    router.push('/sucursal');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between px-4">
        {/* Logo + sucursal */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <Package className="h-4 w-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-gray-900 leading-tight">GestiónStock</p>
            <p className="text-xs text-gray-500 leading-tight">{nombreSucursal} · {codigoSucursal}</p>
          </div>
        </div>

        {/* Nav desktop */}
        <nav className="hidden md:flex items-center gap-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
          <Link
            href="/inventario/nuevo"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Package className="h-4 w-4" />
            Inventario
          </Link>
          <Link
            href="/vencimientos/nuevo"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
            Vencimientos
          </Link>
        </nav>

        {/* Usuario + acciones */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:block text-sm text-gray-600">{nombreUsuario}</span>
          <button
            onClick={handleCambiarSucursal}
            className="hidden md:flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cambiar sucursal
          </button>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{loggingOut ? 'Saliendo...' : 'Salir'}</span>
          </button>
          {/* Hamburger mobile */}
          <button
            className="md:hidden rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menú mobile */}
      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2 md:hidden">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            {nombreSucursal} · {codigoSucursal}
          </p>
          <nav className="flex flex-col gap-1">
            <Link href="/dashboard" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
            <Link href="/inventario/nuevo" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">
              <Package className="h-4 w-4" /> Nuevo control de inventario
            </Link>
            <Link href="/vencimientos/nuevo" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">
              <ChevronRight className="h-4 w-4" /> Nuevo control de vencimientos
            </Link>
            <button onClick={handleCambiarSucursal}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 text-left">
              Cambiar sucursal
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
