import { useEffect, useMemo, useState } from 'react';

export type TamPaginaDatatable = 20 | 50 | 100 | 'all';

export const TAM_PAGINA_DATATABLE_DEFAULT: TamPaginaDatatable = 20;

export const OPCIONES_TAM_PAGINA_DATATABLE: {
  value: TamPaginaDatatable;
  label: string;
}[] = [
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'Todos' },
];

export function calcularRangoPaginacion(
  totalFilas: number,
  paginaActual: number,
  tamPagina: TamPaginaDatatable
): { inicio: number; fin: number; totalPaginas: number } {
  if (totalFilas === 0) {
    return { inicio: 0, fin: 0, totalPaginas: 1 };
  }
  if (tamPagina === 'all') {
    return { inicio: 1, fin: totalFilas, totalPaginas: 1 };
  }
  const totalPaginas = Math.max(1, Math.ceil(totalFilas / tamPagina));
  const pagina = Math.min(Math.max(paginaActual, 1), totalPaginas);
  const inicio = (pagina - 1) * tamPagina + 1;
  const fin = Math.min(pagina * tamPagina, totalFilas);
  return { inicio, fin, totalPaginas };
}

export function paginarFilas<T>(
  filas: T[],
  paginaActual: number,
  tamPagina: TamPaginaDatatable
): T[] {
  if (tamPagina === 'all') return filas;
  const { totalPaginas } = calcularRangoPaginacion(filas.length, paginaActual, tamPagina);
  const pagina = Math.min(Math.max(paginaActual, 1), totalPaginas);
  const inicio = (pagina - 1) * tamPagina;
  return filas.slice(inicio, inicio + tamPagina);
}

/** Paginación cliente: resetea página al cambiar filtros. */
export function usePaginacionCliente(resetDeps: unknown[] = []) {
  const [paginaActual, setPaginaActual] = useState(1);
  const [tamPagina, setTamPagina] = useState<TamPaginaDatatable>(TAM_PAGINA_DATATABLE_DEFAULT);

  useEffect(() => {
    setPaginaActual(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetDeps, tamPagina]);

  return {
    paginaActual,
    setPaginaActual,
    tamPagina,
    setTamPagina,
    onTamPaginaChange: (next: TamPaginaDatatable) => {
      setTamPagina(next);
      setPaginaActual(1);
    },
  };
}

export function useTotalPaginas(totalFilas: number, tamPagina: TamPaginaDatatable) {
  return useMemo(
    () => calcularRangoPaginacion(totalFilas, 1, tamPagina).totalPaginas,
    [totalFilas, tamPagina]
  );
}

/** Paginación servidor: resetea página al cambiar filtros o tamaño. */
export function usePaginacionServidor(resetDeps: unknown[] = []) {
  const [paginaActual, setPaginaActual] = useState(1);
  const [tamPagina, setTamPagina] = useState<TamPaginaDatatable>(TAM_PAGINA_DATATABLE_DEFAULT);

  useEffect(() => {
    setPaginaActual(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetDeps, tamPagina]);

  return {
    paginaActual,
    setPaginaActual,
    tamPagina,
    setTamPagina,
    onTamPaginaChange: (next: TamPaginaDatatable) => {
      setTamPagina(next);
      setPaginaActual(1);
    },
  };
}
