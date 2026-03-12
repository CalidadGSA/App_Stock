'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, ClipboardList, CalendarClock, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface NavbarProps {
  nombreUsuario: string;
  nombreSucursal: string;
  codigoSucursal: string;
}

export default function Navbar({ nombreUsuario, nombreSucursal, codigoSucursal }: NavbarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [rol, setRol] = useState<'admin' | 'operador_sucursal'>('operador_sucursal');

  useEffect(() => {
    async function cargarRol() {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (json?.data?.rol === 'admin') {
          setRol('admin');
        }
      } catch {
        // Ignorar errores: se mantiene rol por defecto
      }
    }
    void cargarRol();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
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
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        {/* Logo + app name */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-8 w-8 items-center justify-center shrink-0">
            <img src="/logogsa800.png" alt="Logo" className="h-8 w-8 object-contain rounded-lg" />
          </div>
          <Link href="/dashboard" className="hidden sm:block">
            <p className="text-sm font-semibold text-gray-900 leading-tight">Gestión Stock</p>
          </Link>
        </div>

        {/* Derecha: sucursal, operador, botones Inventario / Vencimientos, Salir */}
        <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
          <div className="hidden lg:flex items-center gap-4 shrink-0">
            <span className="text-sm text-gray-600 truncate max-w-[180px]" title={nombreSucursal}>
              {nombreSucursal || codigoSucursal}
            </span>
            <span className="text-sm font-medium text-gray-800 truncate max-w-[160px]" title={nombreUsuario}>
              {nombreUsuario}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {rol === 'admin' ? (
              <>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => router.push('/inventario/auditoria')}
                >
                  <ClipboardList className="h-4 w-4" />
                  Auditoría
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => router.push('/inventario/ocasional')}
                >
                  <ClipboardList className="h-4 w-4" />
                  Inventario ocasional
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => router.push('/inventario/nuevo')}
                >
                  <ClipboardList className="h-4 w-4" />
                  Inventario diario
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => router.push('/inventario/ocasional')}
                >
                  <ClipboardList className="h-4 w-4" />
                  Inventario ocasional
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => router.push('/vencimientos/nuevo')}
                >
                  <CalendarClock className="h-4 w-4" />
                  Control de vencimientos
                </Button>
              </>
            )}
          </div>
          {rol === 'admin' && (
            <button
              onClick={handleCambiarSucursal}
              className="hidden md:flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
            >
              Cambiar sucursal
            </button>
          )}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{loggingOut ? 'Saliendo...' : 'Salir'}</span>
          </button>
          <button
            className="md:hidden rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 shrink-0"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menú mobile */}
      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2 md:hidden">
          <div className="mb-3 space-y-1">
            <p className="text-sm font-medium text-gray-800">{nombreSucursal || codigoSucursal}</p>
            <p className="text-xs text-gray-500">{nombreUsuario}</p>
          </div>
          <nav className="flex flex-col gap-1">
            {rol === 'admin' ? (
              <>
                <Button
                  size="sm"
                  className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/inventario/auditoria');
                  }}
                >
                  <ClipboardList className="h-4 w-4" /> Auditoría
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/inventario/ocasional');
                  }}
                >
                  <ClipboardList className="h-4 w-4" /> Inventario ocasional
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/inventario/nuevo');
                  }}
                >
                  <ClipboardList className="h-4 w-4" /> Inventario diario
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/inventario/ocasional');
                  }}
                >
                  <ClipboardList className="h-4 w-4" /> Inventario ocasional
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/vencimientos/nuevo');
                  }}
                >
                  <CalendarClock className="h-4 w-4" /> Control de vencimientos
                </Button>
              </>
            )}
            {rol === 'admin' && (
              <button
                onClick={handleCambiarSucursal}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 text-left w-full"
              >
                Cambiar sucursal
              </button>
            )}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left w-full"
            >
              <LogOut className="h-4 w-4" /> {loggingOut ? 'Saliendo...' : 'Salir'}
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
