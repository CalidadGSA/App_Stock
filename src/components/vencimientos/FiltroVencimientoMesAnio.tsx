'use client';

type MesVencOption = { readonly value: number; readonly label: string };

const SELECT_CLASS =
  'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-100';

type FiltroVencimientoMesAnioProps = {
  mesVencValido: number | null | undefined;
  anioVencValido: number | null | undefined;
  mesesVencOpts: readonly MesVencOption[];
  aniosVencOpts: number[];
  onMesChange: (value: string) => void;
  onAnioChange: (value: string) => void;
  selectClassName?: string;
};

/** Mes y año de vencimiento en un solo bloque (evita separarlos en desktop). */
export function FiltroVencimientoMesAnio({
  mesVencValido,
  anioVencValido,
  mesesVencOpts,
  aniosVencOpts,
  onMesChange,
  onAnioChange,
  selectClassName = SELECT_CLASS,
}: FiltroVencimientoMesAnioProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Vencimiento</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label className="text-xs text-gray-500 dark:text-gray-400">Mes</label>
          <select
            value={mesVencValido ?? ''}
            onChange={(e) => onMesChange(e.target.value)}
            className={selectClassName}
            aria-label="Mes de vencimiento"
          >
            <option value="">Todos</option>
            {mesesVencOpts.map((m) => (
              <option key={m.value} value={String(m.value)}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <label className="text-xs text-gray-500 dark:text-gray-400">Año</label>
          <select
            value={anioVencValido ?? ''}
            onChange={(e) => onAnioChange(e.target.value)}
            className={selectClassName}
            aria-label="Año de vencimiento"
          >
            <option value="">Todos</option>
            {aniosVencOpts.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Grilla uniforme para paneles de filtros de vencimientos en desktop. */
export const VENCIMIENTOS_FILTROS_GRID_CLASS =
  'grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 items-end';

export const VENCIMIENTOS_FILTRO_SELECT_CLASS = SELECT_CLASS;
