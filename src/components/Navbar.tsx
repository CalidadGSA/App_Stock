'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, ClipboardList, CalendarClock, Menu, X, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { isAdminLikeRole } from '@/lib/auth/roles';

interface NavbarProps {
  nombreUsuario: string;
  nombreSucursal: string;
  codigoSucursal: string;
}

export default function Navbar({ nombreUsuario, nombreSucursal, codigoSucursal }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [rol, setRol] = useState<'superadmin' | 'admin' | 'operador_sucursal'>('operador_sucursal');
  const [modoOscuro, setModoOscuro] = useState(false);
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [changingMaintenance, setChangingMaintenance] = useState(false);

  const estaEnControlInventario =
    pathname.startsWith('/inventario/') &&
    pathname !== '/inventario/nuevo' &&
    pathname !== '/inventario/ocasional' &&
    pathname !== '/inventario/auditoria';

  const estaEnControlVencimientos =
    pathname.startsWith('/vencimientos/') &&
    pathname !== '/vencimientos/nuevo';

  const ocultarAccionesOperativas = estaEnControlInventario || estaEnControlVencimientos;

  useEffect(() => {
    async function cargarRol() {
      try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (
          json?.data?.rol === 'admin' ||
          json?.data?.rol === 'superadmin' ||
          json?.data?.rol === 'operador_sucursal'
        ) {
          setRol(json.data.rol);
        }
      } catch {
        // Ignorar errores: se mantiene rol por defecto
      }
    }
    void cargarRol();
  }, []);

  useEffect(() => {
    if (rol !== 'superadmin') return;

    async function cargarEstadoMantenimiento() {
      try {
        const res = await fetch('/api/admin/maintenance');
        const json = await res.json();
        if (res.ok) {
          setMaintenanceActive(Boolean(json?.maintenance));
        }
      } catch {
        // Si falla, mantenemos último estado.
      }
    }

    void cargarEstadoMantenimiento();
  }, [rol]);

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
  }

  async function handleToggleMaintenance() {
    if (rol !== 'superadmin') return;

    const next = !maintenanceActive;
    const ok = window.confirm(
      next
        ? '¿Activar modo mantenimiento? Esto cerrará sesiones activas.'
        : '¿Desactivar modo mantenimiento y reabrir el acceso?'
    );
    if (!ok) return;

    setChangingMaintenance(true);
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next ? 1 : 0 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(json?.error ?? 'No se pudo cambiar el modo mantenimiento.');
        return;
      }
      setMaintenanceActive(Boolean(json?.maintenance));
    } catch {
      window.alert('No se pudo cambiar el modo mantenimiento.');
    } finally {
      setChangingMaintenance(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        {/* Logo + app name */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/dashboard"
            className="flex h-8 w-8 items-center justify-center shrink-0"
            onClick={() => setMenuOpen(false)}
            aria-label="Ir al dashboard"
          >
            <img src="/logogsa800.png" alt="Logo" className="h-8 w-8 object-contain rounded-lg" />
          </Link>
          <Link href="/dashboard" className="hidden sm:block">
            <p className="text-sm font-semibold text-gray-900 leading-tight">Gestión Stock</p>
          </Link>
        </div>

        {/* Derecha: sucursal, operador, botones Inventario / Vencimientos, Salir */}
        <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
          <div className="hidden xl:flex items-center gap-4 shrink-0">
            <span className="text-sm text-gray-600 truncate max-w-[180px]" title={nombreSucursal}>
              {nombreSucursal || codigoSucursal}
            </span>
            <span className="text-sm font-medium text-gray-800 truncate max-w-[160px]" title={nombreUsuario}>
              {nombreUsuario}
            </span>
          </div>
          <div className="hidden xl:flex items-center gap-2">
            {!ocultarAccionesOperativas && (
              <>
            {isAdminLikeRole(rol) ? (
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
                  <span className="lg:hidden">Diario</span>
                  <span className="hidden lg:inline">Inventario diario</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => router.push('/inventario/ocasional')}
                >
                  <ClipboardList className="h-4 w-4" />
                  <span className="lg:hidden">Ocasional</span>
                  <span className="hidden lg:inline">Inventario ocasional</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => router.push('/vencimientos/nuevo')}
                >
                  <CalendarClock className="h-4 w-4" />
                  <span className="lg:hidden">Vencimientos</span>
                  <span className="hidden lg:inline">Control de vencimientos</span>
                </Button>
              </>
            )}
              </>
            )}
          </div>
          {isAdminLikeRole(rol) && !ocultarAccionesOperativas && (
            <button
              onClick={handleCambiarSucursal}
              className="hidden xl:flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
            >
              Cambiar sucursal
            </button>
          )}
          <button
            onClick={toggleModoOscuro}
            className="hidden xl:inline-flex items-center justify-center rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
            title={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
            aria-label={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
          >
            {modoOscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {rol === 'superadmin' && (
            <button
              onClick={handleToggleMaintenance}
              disabled={changingMaintenance}
              className={`hidden xl:flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors shrink-0 ${
                maintenanceActive
                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {changingMaintenance
                ? 'Actualizando...'
                : maintenanceActive
                ? 'Desactivar mantenimiento'
                : 'Activar mantenimiento'}
            </button>
          )}
          {!ocultarAccionesOperativas && (
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors shrink-0"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{loggingOut ? 'Saliendo...' : 'Salir'}</span>
            </button>
          )}
          <button
            className="xl:hidden rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 shrink-0"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menú mobile */}
      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2 xl:hidden">
          <div className="mb-3 space-y-1">
            <p className="text-sm font-medium text-gray-800">{nombreSucursal || codigoSucursal}</p>
            <p className="text-xs text-gray-500">{nombreUsuario}</p>
          </div>
          <nav className="flex flex-col gap-1">
            {!ocultarAccionesOperativas && (isAdminLikeRole(rol) ? (
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
            ))}
            {isAdminLikeRole(rol) && !ocultarAccionesOperativas && (
              <button
                onClick={handleCambiarSucursal}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 text-left w-full"
              >
                Cambiar sucursal
              </button>
            )}
            <button
              onClick={toggleModoOscuro}
              className="flex items-center justify-center rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 text-left w-full"
              title={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
              aria-label={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
            >
              {modoOscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {rol === 'superadmin' && (
              <button
                onClick={handleToggleMaintenance}
                disabled={changingMaintenance}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left w-full ${
                  maintenanceActive
                    ? 'text-amber-700 hover:bg-amber-50'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {changingMaintenance
                  ? 'Actualizando...'
                  : maintenanceActive
                  ? 'Desactivar mantenimiento'
                  : 'Activar mantenimiento'}
              </button>
            )}
            {!ocultarAccionesOperativas && (
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left w-full"
              >
                <LogOut className="h-4 w-4" /> {loggingOut ? 'Saliendo...' : 'Salir'}
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
