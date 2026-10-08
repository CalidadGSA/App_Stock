'use client';

import { useEffect, useRef, useState } from 'react';
import type { PendingAppPromptNumero } from './app-confirm-types';

/**
 * Diálogo de la app para pedir una cantidad. Reemplaza a `window.prompt`, que en móvil se ve
 * como un cartel del navegador y no respeta el estilo ni el modo oscuro.
 */
export function AppPromptNumeroDialog({
  pedido,
  onAnswer,
}: {
  pedido: PendingAppPromptNumero | null;
  onAnswer: (value: number | null) => void;
}) {
  if (!pedido) return null;
  // La `key` reinicia el estado en cada pedido nuevo, sin necesidad de sincronizarlo con un efecto.
  return <Dialogo key={pedido.id} pedido={pedido} onAnswer={onAnswer} />;
}

function Dialogo({
  pedido,
  onAnswer,
}: {
  pedido: PendingAppPromptNumero;
  onAnswer: (value: number | null) => void;
}) {
  const [texto, setTexto] = useState(() =>
    pedido.valorInicial != null ? String(pedido.valorInicial) : ''
  );
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Foco y selección para poder escribir encima directamente.
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  const min = pedido.min ?? 0;
  const max = pedido.max;

  function aceptar() {
    const n = parseInt(texto, 10);
    if (!Number.isFinite(n)) {
      setError('Escribí un número.');
      return;
    }
    if (n < min) {
      setError(`El mínimo es ${min}.`);
      return;
    }
    if (max != null && n > max) {
      setError(`El máximo es ${max}.`);
      return;
    }
    onAnswer(n);
  }

  const peligro = pedido.variant === 'danger';
  const aviso = pedido.variant === 'warning';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancelar"
        className="absolute inset-0 bg-black/50"
        onClick={() => onAnswer(null)}
      />
      <div className="relative w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-slate-900">
        {pedido.title && (
          <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {pedido.title}
          </h2>
        )}
        <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">
          {pedido.message}
        </p>
        {pedido.detalle && (
          <p className="mt-1 whitespace-pre-line text-xs text-gray-500 dark:text-gray-400">
            {pedido.detalle}
          </p>
        )}

        <label className="mt-3 block">
          {pedido.label && (
            <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {pedido.label}
            </span>
          )}
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            value={texto}
            min={min}
            max={max}
            onChange={(e) => {
              setTexto(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                aceptar();
              }
              if (e.key === 'Escape') onAnswer(null);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-semibold tabular-nums text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-100"
          />
        </label>

        {max != null && (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Entre {min} y {max}.
          </p>
        )}
        {error && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(null)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {pedido.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={aceptar}
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${
              peligro
                ? 'bg-red-600 hover:bg-red-700'
                : aviso
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {pedido.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
