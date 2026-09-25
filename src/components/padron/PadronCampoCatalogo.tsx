'use client';

import { useMemo } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import {
  evaluarValor,
  type ValorCatalogo,
} from '@/lib/padron/valores-catalogo';

/**
 * Campo de texto para `categoria` / `sub_categoria` con autocompletado y aviso cuando el valor
 * no existe todavía. Evita que un error de tipeo cree una categoría nueva sin querer.
 */
export default function PadronCampoCatalogo({
  columna,
  valor,
  catalogo,
  disabled,
  onChange,
}: {
  columna: string;
  valor: string;
  catalogo: ValorCatalogo[];
  disabled?: boolean;
  onChange: (valor: string) => void;
}) {
  const listId = `catalogo-${columna}`;
  const resultado = useMemo(() => evaluarValor(valor, catalogo), [valor, catalogo]);

  return (
    <>
      <input
        type="text"
        list={listId}
        disabled={disabled}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-gray-100 disabled:text-gray-500"
      />
      <datalist id={listId}>
        {catalogo.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.usos.toLocaleString('es-AR')} productos
          </option>
        ))}
      </datalist>

      {resultado?.tipo === 'exacto' && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3 shrink-0" />
          Valor existente
        </p>
      )}

      {resultado?.tipo === 'equivalente' && (
        <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            Ya existe escrito como{' '}
            <button
              type="button"
              onClick={() => onChange(resultado.valor)}
              className="font-semibold underline underline-offset-2"
            >
              {resultado.valor}
            </button>
            . Conviene usar esa forma para no duplicar.
          </p>
        </div>
      )}

      {resultado?.tipo === 'nuevo' && (
        <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex items-start gap-1 font-medium">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            «{valor.trim()}» no existe todavía: se va a crear como valor nuevo.
          </p>
          {resultado.similares.length > 0 && (
            <div className="mt-1">
              <p className="text-amber-800 dark:text-amber-300">¿Quisiste decir…?</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {resultado.similares.map((s) => (
                  <button
                    key={s.valor}
                    type="button"
                    onClick={() => onChange(s.valor)}
                    title={`${s.usos.toLocaleString('es-AR')} productos`}
                    className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                  >
                    {s.valor}
                    <span className="ml-1 font-normal text-amber-700 dark:text-amber-400">
                      ({s.usos.toLocaleString('es-AR')})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
