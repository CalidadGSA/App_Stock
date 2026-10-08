import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDateTime } from '@/lib/utils';
import type { PsicotropicoEnStock } from '@/lib/stock/psicotropicos-en-stock';

export interface DatosListadoPsicotropicos {
  sucursal: { nombre: string; domicilio: string; telefono: string };
  operador: string;
  generado_at: string;
  productos: PsicotropicoEnStock[];
}

const GRIS: [number, number, number] = [107, 114, 128];
const TEXTO: [number, number, number] = [17, 24, 39];

export function formatImporte(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCantidad(p: Pick<PsicotropicoEnStock, 'cajas' | 'unidades'>): string {
  const cajas = p.cajas.toLocaleString('es-AR');
  return p.unidades > 0 ? `${cajas} + ${p.unidades.toLocaleString('es-AR')} u.` : cajas;
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function horaArgentina(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

async function cargarLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo-gsa-light.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function descargarPdfPsicotropicos(datos: DatosListadoPsicotropicos): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const margen = 40;
  const derecha = ancho - margen;

  const { sucursal, operador, generado_at, productos } = datos;
  const fechaHora = `${fechaLarga(generado_at)} · ${horaArgentina(generado_at)} hs`;
  const totalCajas = productos.reduce((acc, p) => acc + p.cajas, 0);
  const totalUnidades = productos.reduce((acc, p) => acc + p.unidades, 0);
  const totalPvp = productos.reduce((acc, p) => acc + (p.pvpTotal ?? 0), 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text('DOCUMENTO NO VÁLIDO COMO FACTURA', ancho / 2, 28, { align: 'center' });

  const logo = await cargarLogo();
  if (logo) doc.addImage(logo, 'PNG', derecha - 72, 38, 72, 72);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...TEXTO);
  doc.text(sucursal.nombre.toUpperCase(), margen, 62);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let y = 80;
  if (sucursal.domicilio) {
    doc.text(sucursal.domicilio, margen, y);
    y += 13;
  }
  if (sucursal.telefono) {
    doc.text(`Tel.: ${sucursal.telefono}`, margen, y);
    y += 13;
  }

  y = Math.max(y, 118) + 10;
  doc.setFontSize(9);
  doc.text(`Generado por: ${operador || '—'}`, margen, y);
  doc.text(fechaHora, derecha, y, { align: 'right' });

  y += 10;
  doc.setDrawColor(209, 213, 219);
  doc.line(margen, y, derecha, y);

  y += 26;
  doc.setFontSize(14);
  doc.text('Listado de Psicotrópicos en Stock', ancho / 2, y, { align: 'center' });
  y += 18;
  doc.setFontSize(12);
  doc.text(`Sucursal: ${sucursal.nombre}`, ancho / 2, y, { align: 'center' });
  y += 15;
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  const resumen =
    `${productos.length.toLocaleString('es-AR')} productos · ` +
    `${totalCajas.toLocaleString('es-AR')} cajas` +
    (totalUnidades > 0 ? ` + ${totalUnidades.toLocaleString('es-AR')} unidades sueltas` : '');
  doc.text(resumen, ancho / 2, y, { align: 'center' });

  const pie = `${sucursal.nombre} · Psicotrópicos en stock · ${formatDateTime(generado_at)} · ${operador}`;

  autoTable(doc, {
    startY: y + 14,
    margin: { left: margen, right: margen, bottom: 40 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }, textColor: TEXTO },
    headStyles: { fontStyle: 'bold', textColor: TEXTO, fillColor: [243, 244, 246] },
    footStyles: { fontStyle: 'bold', textColor: TEXTO, fillColor: [243, 244, 246] },
    columnStyles: {
      0: { cellWidth: 82 },
      2: { cellWidth: 92 },
      3: { cellWidth: 58, halign: 'right' },
      4: { cellWidth: 72, halign: 'right' },
    },
    head: [['CODEBAR', 'PRODUCTO', 'LABORATORIO', 'CANTIDAD', 'PVP TOTAL']],
    body: productos.map((p) => [
      p.codebar || '—',
      p.producto || `Producto ${p.idproducto}`,
      p.laboratorio || '—',
      formatCantidad(p),
      formatImporte(p.pvpTotal),
    ]),
    foot: [['', 'TOTAL', '', totalCajas.toLocaleString('es-AR'), formatImporte(totalPvp)]],
    showFoot: 'lastPage',
    didParseCell: (data) => {
      if (data.section === 'head' && (data.column.index === 3 || data.column.index === 4)) {
        data.cell.styles.halign = 'right';
      }
      if (data.section === 'foot' && (data.column.index === 3 || data.column.index === 4)) {
        data.cell.styles.halign = 'right';
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
      doc.setDrawColor(229, 231, 235);
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(pie, margen, alto - 20, { maxWidth: ancho - margen * 2 - 80 });
    doc.text(`Página ${i} de ${paginas}`, derecha, alto - 20, { align: 'right' });
  }

  doc.setProperties({ title: `Psicotrópicos en stock - ${sucursal.nombre}` });

  const fechaArchivo = new Date(generado_at)
    .toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  const nombreArchivo = sucursal.nombre.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  doc.save(`psicotropicos_stock_${nombreArchivo || 'sucursal'}_${fechaArchivo}.pdf`);
}
