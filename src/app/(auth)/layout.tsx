 'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const [modoOscuro, setModoOscuro] = useState(false);

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

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-950 dark:to-slate-900 px-4">
      <button
        type="button"
        onClick={toggleModoOscuro}
        className="absolute right-4 top-4 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-slate-900/80 p-2 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
        title={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
        aria-label={modoOscuro ? 'Desactivar modo oscuro' : 'Activar modo oscuro'}
      >
        {modoOscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      {children}
    </div>
  );
}
