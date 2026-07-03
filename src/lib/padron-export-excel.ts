import * as XLSX from 'xlsx';
import type { PadronMeta } from '@/lib/padron-final-crud';

function cellValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildPadronExcelBuffer(
  rows: Record<string, unknown>[],
  columnNames: string[],
  meta: PadronMeta
): Buffer {
  const header = columnNames;
  const body = rows.map((row) => header.map((col) => cellValue(row[col])));

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  const colWidths = header.map((col, colIdx) => {
    const headerLen = col.length;
    let maxData = 0;
    for (const row of body) {
      const len = String(row[colIdx] ?? '').length;
      if (len > maxData) maxData = len;
    }
    return { wch: Math.min(48, Math.max(headerLen, maxData) + 2) };
  });
  ws['!cols'] = colWidths;

  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: header.length - 1 },
      }),
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Padron');

  const metaRows: (string | number | boolean)[][] = [
    ['Campo', 'Valor'],
    ['Tabla', 'padron_final'],
    ['Clave primaria', meta.primaryKey],
    ['Columnas exportadas', columnNames.length],
    ['Filas exportadas', rows.length],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
  wsMeta['!cols'] = [{ wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Info');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function padronExportFileName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `padron-productos_${y}${m}${day}.xlsx`;
}
