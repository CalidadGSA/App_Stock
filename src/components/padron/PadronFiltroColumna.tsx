'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PadronFiltrosColumna, ValorFiltroColumna } from '@/lib/padron-final-crud';

const ANCHO_PANEL = 300;
/** Alto máximo del panel; se recorta según el espacio real que quede en pantalla. */
const ALTO_MAX_PANEL = 480;
/** Debajo de esto el panel no es usable, así que conviene abrirlo hacia arriba. */
const ALTO_MIN_UTIL = 260;
const MARGEN = 12;

/**
 * Botón de filtro en el encabezado de una columna, con desplegable tipo Excel: buscador,
 * «Seleccionar todo» y lista de valores con su cantidad. Al aceptar devuelve los valores
 * elegidos, o `null` si quedaron todos (sin filtro).
 */
export default function PadronFiltroColumna({
  columna,
  filtroActual,
  contexto,
  onAplicar,
}: {
  columna: string;
  /** Valores admitidos hoy en esta columna (`undefined` = sin filtro). */
  filtroActual: string[] | undefined;
  /** Búsqueda y filtros vigentes: los valores se listan según el resto de los filtros. */
  contexto: { q: string; searchColumn: string; filtros: PadronFiltrosColumna };
  onAplicar: (valores: string[] | null) => void;
}) {
  /** Posición y alto del panel; `null` = cerrado. */
  const [abierto, setAbierto] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const activo = (filtroActual?.length ?? 0) > 0;

  function alternar() {
    if (abierto) {
      setAbierto(null);
      return;
    }
    const r = botonRef.current?.getBoundingClientRect();
    if (!r) return;

    const left = Math.max(8, Math.min(r.left, window.innerWidth - ANCHO_PANEL - 8));
    const espacioAbajo = window.innerHeight - r.bottom - MARGEN;
    const espacioArriba = r.top - MARGEN;

    // Si abajo no entra y arriba hay más lugar, el panel se despliega hacia arriba.
    if (espacioAbajo < ALTO_MIN_UTIL && espacioArriba > espacioAbajo) {
      const maxHeight = Math.min(ALTO_MAX_PANEL, espacioArriba);
      setAbierto({ top: Math.max(MARGEN, r.top - maxHeight - 4), left, maxHeight });
      return;
    }

    setAbierto({
      top: r.bottom + 4,
      left,
      maxHeight: Math.max(ALTO_MIN_UTIL, Math.min(ALTO_MAX_PANEL, espacioAbajo)),
    });
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={alternar}
        className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded ${
          activo
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'
        }`}
        title={activo ? `Filtrado (${filtroActual!.length} valores)` : 'Filtrar esta columna'}
        aria-label={`Filtrar ${columna}`}
        aria-expanded={abierto !== null}
      >
        <Filter className="h-3 w-3" />
      </button>
      {abierto && (
        <PanelFiltro
          pos={abierto}
          anclaRef={botonRef}
          columna={columna}
          filtroActual={filtroActual}
          contexto={contexto}
          onCerrar={() => {
            setAbierto(null);
            botonRef.current?.focus();
          }}
          onAplicar={(v) => {
            setAbierto(null);
            onAplicar(v);
          }}
        />
      )}
    </>
  );
}

function etiquetaValor(valor: string): string {
  return valor === '' ? '(Vacías)' : valor;
}

function PanelFiltro({
  pos,
  anclaRef,
  columna,
  filtroActual,
  contexto,
  onCerrar,
  onAplicar,
}: {
  pos: { top: number; left: number; maxHeight: number };
  anclaRef: RefObject<HTMLButtonElement | null>;
  columna: string;
  filtroActual: string[] | undefined;
  contexto: { q: string; searchColumn: string; filtros: PadronFiltrosColumna };
  onCerrar: () => void;
  onAplicar: (valores: string[] | null) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const buscarRef = useRef<HTMLInputElement>(null);
  const [buscar, setBuscar] = useState('');
  const [valores, setValores] = useState<ValorFiltroColumna[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  /** Valores tildados. Sin filtro previo, arranca con todo tildado (como Excel). */
  const [tildados, setTildados] = useState<Set<string> | 'todos'>(
    filtroActual && filtroActual.length > 0 ? new Set(filtroActual) : 'todos'
  );

  useEffect(() => {
    buscarRef.current?.focus();
  }, []);

  const contextoJson = JSON.stringify(contexto);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const ctx = JSON.parse(contextoJson) as typeof contexto;
      const params = new URLSearchParams({ columna });
      if (ctx.q.trim()) params.set('q', ctx.q.trim());
      if (ctx.searchColumn) params.set('searchColumn', ctx.searchColumn);
      if (Object.keys(ctx.filtros).length > 0) params.set('filters', JSON.stringify(ctx.filtros));
      if (buscar.trim()) params.set('buscar', buscar.trim());
      setCargando(true);
      setError('');
      fetch(`/api/admin/padron-productos/filtro-valores?${params.toString()}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      })
        .then(async (res) => {
          const json = (await res.json()) as {
            valores?: ValorFiltroColumna[];
            truncado?: boolean;
            error?: string;
          };
          if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los valores');
          setValores(json.valores ?? []);
          setTruncado(Boolean(json.truncado));
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los valores');
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setCargando(false);
        });
    }, buscar ? 250 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [columna, contextoJson, buscar]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anclaRef.current?.contains(target)) return;
      onCerrar();
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onCerrar);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onCerrar);
    };
  }, [anclaRef, onCerrar]);

  const estaTildado = (v: string) => tildados === 'todos' || tildados.has(v);
  const visiblesTildados = useMemo(
    () => valores.filter((v) => tildados === 'todos' || tildados.has(v.valor)).length,
    [valores, tildados]
  );
  const todosVisiblesTildados = valores.length > 0 && visiblesTildados === valores.length;

  function toggle(valor: string) {
    setTildados((prev) => {
      const next = new Set(prev === 'todos' ? valores.map((v) => v.valor) : prev);
      if (next.has(valor)) next.delete(valor);
      else next.add(valor);
      return next;
    });
  }

  function toggleTodos(checked: boolean) {
    setTildados((prev) => {
      if (!buscar.trim()) return checked ? 'todos' : new Set();
      const next = new Set(prev === 'todos' ? valores.map((v) => v.valor) : prev);
      for (const v of valores) {
        if (checked) next.add(v.valor);
        else next.delete(v.valor);
      }
      return next;
    });
  }

  function aceptar() {
    if (buscar.trim()) {
      // Como Excel: con búsqueda, el filtro queda en lo tildado entre los resultados.
      onAplicar(valores.filter((v) => estaTildado(v.valor)).map((v) => v.valor));
      return;
    }
    if (tildados === 'todos' || (todosVisiblesTildados && !truncado)) {
      onAplicar(null);
      return;
    }
    onAplicar(Array.from(tildados));
  }

  const sinSeleccion = tildados !== 'todos' && valores.every((v) => !tildados.has(v.valor));

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Filtro de ${columna}`}
      style={{ top: pos.top, left: pos.left, width: ANCHO_PANEL, maxHeight: pos.maxHeight }}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCerrar();
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          if (!sinSeleccion) aceptar();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <span className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
          Filtrar «{columna}»
        </span>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            ref={buscarRef}
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar…"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-7 pr-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : cargando && valores.length === 0 ? (
          <p className="text-xs text-gray-500">Cargando valores…</p>
        ) : valores.length === 0 ? (
          <p className="text-xs text-gray-500">Sin valores.</p>
        ) : (
          <ul className={`flex flex-col ${cargando ? 'opacity-60' : ''}`}>
            <li className="border-b border-gray-100 pb-1 dark:border-gray-800">
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
                <input
                  type="checkbox"
                  checked={todosVisiblesTildados}
                  ref={(el) => {
                    if (el) el.indeterminate = visiblesTildados > 0 && !todosVisiblesTildados;
                  }}
                  onChange={(e) => toggleTodos(e.target.checked)}
                />
                {buscar.trim() ? 'Seleccionar todos los resultados' : 'Seleccionar todo'}
              </label>
            </li>
            {valores.map((v) => (
              <li key={v.valor}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input
                    type="checkbox"
                    checked={estaTildado(v.valor)}
                    onChange={() => toggle(v.valor)}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${v.valor === '' ? 'italic text-gray-500' : ''}`}
                    title={etiquetaValor(v.valor)}
                  >
                    {etiquetaValor(v.valor)}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                    {v.usos.toLocaleString('es-AR')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {truncado && (
          <p className="mt-2 text-[11px] text-amber-700">
            Se muestran los primeros {valores.length.toLocaleString('es-AR')} valores. Usá el
            buscador para encontrar el resto.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
        <button
          type="button"
          onClick={() => onAplicar(null)}
          disabled={!filtroActual || filtroActual.length === 0}
          className="text-xs text-gray-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          Quitar filtro
        </button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button size="sm" onClick={aceptar} disabled={sinSeleccion || cargando}>
            Aceptar
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
