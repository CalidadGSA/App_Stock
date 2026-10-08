'use client';

import { useMemo, useState } from 'react';
import { Lock, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PadronCampoCatalogo from '@/components/padron/PadronCampoCatalogo';
import type { PadronColumnMeta, PadronFiltrosColumna, PadronMeta } from '@/lib/padron-final-crud';
import { esColumnaConCatalogo, type ValorCatalogo } from '@/lib/padron/valores-catalogo';

export type AlcanceMasivo = 'seleccion' | 'busqueda';

export type ResultadoMasivo = {
  actualizados: number;
  alcance: number;
  columnas: string[];
};

/** Cambio pendiente por columna: valor nuevo o "dejar vacío". */
type CambioColumna = { valor: string; vaciar: boolean };

export default function PadronEdicionMasiva({
  meta,
  seleccionados,
  filtro,
  totalBusqueda,
  catalogos,
  confirmarValoresNuevos,
  onCerrar,
  onAplicado,
  confirmar,
}: {
  meta: PadronMeta;
  /** PKs tildados en la tabla. */
  seleccionados: string[];
  filtro: { q: string; searchColumn: string; filtros: PadronFiltrosColumna };
  /** Cantidad de productos que matchean la búsqueda y los filtros actuales. */
  totalBusqueda: number;
  /** Valores existentes de `categoria` / `sub_categoria`. */
  catalogos: Record<string, ValorCatalogo[]>;
  /** Devuelve false si hay valores de clasificación nuevos y el usuario no los confirma. */
  confirmarValoresNuevos: (valores: Record<string, unknown>) => Promise<boolean>;
  onCerrar: () => void;
  onAplicado: (r: ResultadoMasivo) => void;
  confirmar: (mensaje: string) => Promise<boolean>;
}) {
  const columnasEditables = useMemo(
    () =>
      meta.columns
        .filter((c) => !c.syncedFrom && c.name !== meta.primaryKey)
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [meta]
  );

  const columnasFiltradas = Object.keys(filtro.filtros);
  const hayTexto = filtro.q.trim().length >= 2;
  const hayBusqueda = hayTexto || columnasFiltradas.length > 0;
  const [alcance, setAlcance] = useState<AlcanceMasivo>(
    seleccionados.length > 0 ? 'seleccion' : 'busqueda'
  );
  const [cambios, setCambios] = useState<Record<string, CambioColumna>>({});
  const [filtroCol, setFiltroCol] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState('');

  const columnasElegidas = Object.keys(cambios);
  const cantidad = alcance === 'seleccion' ? seleccionados.length : totalBusqueda;
  const alcanceValido =
    alcance === 'seleccion' ? seleccionados.length > 0 : hayBusqueda && totalBusqueda > 0;

  const columnasVisibles = useMemo(() => {
    const t = filtroCol.trim().toLowerCase();
    if (!t) return columnasEditables;
    return columnasEditables.filter((c) => c.name.toLowerCase().includes(t));
  }, [columnasEditables, filtroCol]);

  function toggleColumna(col: PadronColumnMeta) {
    setCambios((prev) => {
      const next = { ...prev };
      if (next[col.name]) delete next[col.name];
      else next[col.name] = { valor: '', vaciar: false };
      return next;
    });
  }

  function setCambio(name: string, patch: Partial<CambioColumna>) {
    setCambios((prev) => ({ ...prev, [name]: { ...prev[name]!, ...patch } }));
  }

  function resumenCambios(): string {
    return columnasElegidas
      .map((c) => `${c} = ${cambios[c]!.vaciar ? '(vacío)' : `"${cambios[c]!.valor}"`}`)
      .join(' · ');
  }

  async function aplicar() {
    setError('');
    if (columnasElegidas.length === 0) {
      setError('Elegí al menos una columna para modificar');
      return;
    }
    if (!alcanceValido) {
      setError(
        alcance === 'seleccion'
          ? 'No hay productos seleccionados'
          : 'Hacé una búsqueda de al menos 2 caracteres o filtrá alguna columna'
      );
      return;
    }

    const valores: Record<string, unknown> = {};
    const clasificacion: Record<string, unknown> = {};
    for (const c of columnasElegidas) {
      valores[c] = cambios[c]!.vaciar ? '' : cambios[c]!.valor;
      if (esColumnaConCatalogo(c)) clasificacion[c.toLowerCase()] = valores[c];
    }

    if (!(await confirmarValoresNuevos(clasificacion))) return;

    const ok = await confirmar(
      `Se van a modificar ${cantidad} producto${cantidad === 1 ? '' : 's'} — ${resumenCambios()}. Esta acción no se puede deshacer.`
    );
    if (!ok) return;

    setAplicando(true);
    try {
      const res = await fetch('/api/admin/padron-productos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valores,
          pks: alcance === 'seleccion' ? seleccionados : [],
          q: alcance === 'busqueda' ? filtro.q : '',
          searchColumn: alcance === 'busqueda' ? filtro.searchColumn : '',
          filtros: alcance === 'busqueda' ? filtro.filtros : {},
        }),
      });
      const json = (await res.json()) as ResultadoMasivo & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo aplicar el cambio');
        return;
      }
      onAplicado(json);
    } catch {
      setError('Error de red al aplicar el cambio');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/40" aria-label="Cerrar" onClick={onCerrar} />
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Wand2 className="h-5 w-5 text-blue-600" />
            Edición masiva
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            {/* 1. Alcance */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                1 · A qué productos
              </h3>
              <div className="flex flex-col gap-2">
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                    alcance === 'seleccion'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  } ${seleccionados.length === 0 ? 'opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={alcance === 'seleccion'}
                    disabled={seleccionados.length === 0}
                    onChange={() => setAlcance('seleccion')}
                  />
                  <span>
                    <span className="font-medium text-gray-900">
                      Seleccionados en la tabla ({seleccionados.length})
                    </span>
                    <span className="block text-xs text-gray-500">
                      Solo los productos tildados.
                    </span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                    alcance === 'busqueda'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  } ${!hayBusqueda ? 'opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={alcance === 'busqueda'}
                    disabled={!hayBusqueda}
                    onChange={() => setAlcance('busqueda')}
                  />
                  <span>
                    <span className="font-medium text-gray-900">
                      Todos los resultados de la búsqueda y los filtros ({totalBusqueda})
                    </span>
                    <span className="block text-xs text-gray-500">
                      {hayBusqueda
                        ? `${[
                            hayTexto
                              ? `Búsqueda «${filtro.q}»${
                                  filtro.searchColumn ? ` en ${filtro.searchColumn}` : ' (amplia)'
                                }`
                              : '',
                            columnasFiltradas.length > 0
                              ? `filtros en ${columnasFiltradas.join(', ')}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}. Incluye las páginas que no estás viendo.`
                        : 'Buscá algo o filtrá una columna de la tabla para habilitar esta opción.'}
                    </span>
                  </span>
                </label>
              </div>
            </section>

            {/* 2. Columnas */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                2 · Qué columnas modificar
              </h3>
              <Input
                placeholder="Filtrar columnas…"
                value={filtroCol}
                onChange={(e) => setFiltroCol(e.target.value)}
              />
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                {columnasVisibles.map((c) => {
                  const elegida = !!cambios[c.name];
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => toggleColumna(c)}
                      className={`rounded border px-2 py-0.5 text-xs ${
                        elegida
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {columnasVisibles.length === 0 && (
                  <p className="text-xs text-gray-500">Ninguna columna coincide.</p>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                <Lock className="h-3 w-3" />
                Las columnas que vienen de Plex u Onze no se listan: las escribe el sync.
              </p>
            </section>

            {/* 3. Valores */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                3 · Nuevo valor
              </h3>
              {columnasElegidas.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
                  Elegí una o más columnas arriba.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {columnasElegidas.map((name) => {
                    const cambio = cambios[name]!;
                    return (
                      <div key={name} className="rounded-lg border border-gray-200 p-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900">{name}</span>
                          <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={cambio.vaciar}
                              onChange={(e) => setCambio(name, { vaciar: e.target.checked })}
                            />
                            Dejar vacío
                          </label>
                        </div>
                        {esColumnaConCatalogo(name) && !cambio.vaciar ? (
                          <PadronCampoCatalogo
                            columna={`masiva-${name}`}
                            valor={cambio.valor}
                            catalogo={catalogos[name.toLowerCase()] ?? []}
                            onChange={(v) => setCambio(name, { valor: v })}
                          />
                        ) : (
                          <input
                            type="text"
                            value={cambio.valor}
                            disabled={cambio.vaciar}
                            placeholder={cambio.vaciar ? '(se guardará vacío)' : 'Nuevo valor…'}
                            onChange={(e) => setCambio(name, { valor: e.target.value })}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-gray-100 disabled:text-gray-400"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-600">
            {columnasElegidas.length > 0 && alcanceValido ? (
              <>
                <span className="font-semibold text-gray-900">{cantidad}</span> producto
                {cantidad === 1 ? '' : 's'} · {columnasElegidas.length} columna
                {columnasElegidas.length === 1 ? '' : 's'}
              </>
            ) : (
              'Elegí alcance y columnas'
            )}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onCerrar} disabled={aplicando}>
              Cancelar
            </Button>
            <Button
              size="sm"
              loading={aplicando}
              disabled={columnasElegidas.length === 0 || !alcanceValido}
              onClick={() => void aplicar()}
            >
              Aplicar cambios
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
