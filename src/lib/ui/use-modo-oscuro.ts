'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'theme';

/**
 * Tema claro/oscuro. La fuente de verdad es la clase `dark` del `<html>`, no un estado de React:
 * así no hace falta llamar a `setState` dentro de un efecto (cascada de renders) ni se rompe la
 * hidratación, porque en el servidor el snapshot siempre es "claro".
 */
function esOscuroEnDom(): boolean {
  return document.documentElement.classList.contains('dark');
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function aplicarTema(oscuro: boolean): void {
  document.documentElement.classList.toggle('dark', oscuro);
}

export function useModoOscuro(): {
  modoOscuro: boolean;
  toggleModoOscuro: () => void;
} {
  const modoOscuro = useSyncExternalStore(subscribe, esOscuroEnDom, () => false);

  // Preferencia inicial: lo guardado y, si no hay nada, lo que pida el sistema.
  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage bloqueado (modo privado): se usa la preferencia del sistema.
    }
    if (guardado === 'dark' || guardado === 'light') {
      aplicarTema(guardado === 'dark');
      return;
    }
    aplicarTema(window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  const toggleModoOscuro = useCallback(() => {
    const siguiente = !esOscuroEnDom();
    aplicarTema(siguiente);
    try {
      localStorage.setItem(STORAGE_KEY, siguiente ? 'dark' : 'light');
    } catch {
      // Sin storage el cambio vale solo para esta pestaña.
    }
  }, []);

  return { modoOscuro, toggleModoOscuro };
}
