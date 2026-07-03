export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 500;
export const EXPORT_MAX_ROWS = 10_000;

export type ParsedPagination = {
  page: number;
  pageSize: number;
  offset: number;
  /** Sin límite de página: devuelve hasta `pageSize` filas (p. ej. exportación). */
  unpaginated: boolean;
};

export type PaginatedSlice<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function parsePaginationParams(
  searchParams: URLSearchParams,
  opts?: {
    defaultPageSize?: number;
    maxPageSize?: number;
    exportMaxRows?: number;
  }
): ParsedPagination {
  const defaultPageSize = opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts?.maxPageSize ?? MAX_PAGE_SIZE;
  const exportMaxRows = opts?.exportMaxRows ?? EXPORT_MAX_ROWS;

  const pageRaw = parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const rawSize =
    searchParams.get('pageSize') ?? searchParams.get('page_size') ?? searchParams.get('limit') ?? '';
  const normalized = String(rawSize).trim().toLowerCase();

  if (normalized === 'all' || normalized === '0') {
    return { page: 1, pageSize: exportMaxRows, offset: 0, unpaginated: true };
  }

  const parsedSize = parseInt(normalized, 10);
  const pageSize = Number.isFinite(parsedSize)
    ? Math.min(maxPageSize, Math.max(5, parsedSize))
    : defaultPageSize;

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    unpaginated: false,
  };
}

export function slicePaginated<T>(arr: T[], pagination: ParsedPagination): PaginatedSlice<T> {
  const total = arr.length;
  if (pagination.unpaginated) {
    return {
      data: arr.slice(0, pagination.pageSize),
      total,
      page: 1,
      pageSize: pagination.pageSize,
    };
  }
  return {
    data: arr.slice(pagination.offset, pagination.offset + pagination.pageSize),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export function tamPaginaToPageSizeParam(
  tam: number | 'all',
  opts?: { maxPageSize?: number; exportMaxRows?: number }
): string {
  if (tam === 'all') return 'all';
  const max = opts?.maxPageSize ?? MAX_PAGE_SIZE;
  return String(Math.min(max, Math.max(5, tam)));
}
