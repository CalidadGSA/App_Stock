import { jsPDF } from 'jspdf';
import type { ManualBlock, ManualCoverMeta, ManualPageDef } from '@/lib/manual/types';

const MARGIN_X = 18;
const MARGIN_TOP = 22;
const MARGIN_BOTTOM = 16;
const PAGE_WIDTH_MM = 210;

function contentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - MARGIN_X * 2;
}

function pageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight();
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > pageHeight(doc) - MARGIN_BOTTOM) {
    doc.addPage();
    return MARGIN_TOP;
  }
  return y;
}

function writeWrapped(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  let cy = y;
  for (const line of lines) {
    cy = ensureSpace(doc, cy, lineHeight);
    doc.text(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

function drawFooter(doc: jsPDF, pageNum: number) {
  const h = pageHeight(doc);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Gestión Stock — Manual de usuario', MARGIN_X, h - 9);
  doc.text(String(pageNum).padStart(2, '0'), PAGE_WIDTH_MM - MARGIN_X, h - 9, {
    align: 'right',
  });
  doc.setTextColor(0, 0, 0);
}

function renderCover(doc: jsPDF, cover: ManualCoverMeta) {
  const w = doc.internal.pageSize.getWidth();
  const h = pageHeight(doc);

  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, w, h, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('MANUAL DE USUARIO', MARGIN_X, 36);

  doc.setFontSize(13);
  doc.text('GESTIÓN STOCK', MARGIN_X, 48);

  doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(`Guía para ${cover.rolLabel}`, contentWidth(doc)) as string[];
  doc.text(titleLines, MARGIN_X, 68);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(
    'Instrucciones según los permisos de tu perfil en la aplicación.',
    MARGIN_X,
    68 + titleLines.length * 10 + 4
  );

  doc.setFontSize(10);
  doc.text(`Edición ${cover.edition}`, MARGIN_X, h - 42);

  const mods = cover.modules.join(' · ');
  const modLines = doc.splitTextToSize(mods, contentWidth(doc)) as string[];
  doc.text(modLines, MARGIN_X, h - 30);

  doc.setTextColor(0, 0, 0);
}

function renderBlock(doc: jsPDF, block: ManualBlock, y: number): number {
  const w = contentWidth(doc);
  let cy = y;

  switch (block.type) {
    case 'paragraph': {
      cy += 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85);
      cy = writeWrapped(doc, block.text, MARGIN_X, cy, w, 5.4);
      cy += 3;
      break;
    }
    case 'list': {
      cy += 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85);
      block.items.forEach((item, index) => {
        const prefix = block.ordered ? `${index + 1}. ` : '• ';
        const lines = doc.splitTextToSize(item, w - 6) as string[];
        lines.forEach((line, li) => {
          const row = li === 0 ? `${prefix}${line}` : `   ${line}`;
          cy = ensureSpace(doc, cy, 5.4);
          doc.text(row, MARGIN_X + 1, cy);
          cy += 5.4;
        });
      });
      cy += 3;
      break;
    }
    case 'steps': {
      block.steps.forEach((step, index) => {
        cy = ensureSpace(doc, cy, 14);
        cy += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(17, 24, 39);
        cy = writeWrapped(doc, `${index + 1}. ${step.title}`, MARGIN_X, cy, w, 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        cy = writeWrapped(doc, step.text, MARGIN_X, cy, w, 5.2);
        cy += 4;
      });
      break;
    }
    case 'callout': {
      cy = ensureSpace(doc, cy, 18);
      cy += 2;
      const pad = 4;
      const titleLines = doc.splitTextToSize(block.title, w - pad * 2) as string[];
      const textLines = doc.splitTextToSize(block.text, w - pad * 2) as string[];
      const boxH = (titleLines.length + textLines.length) * 5 + 10;
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(191, 219, 254);
      doc.roundedRect(MARGIN_X, cy - 3, w, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 64, 175);
      doc.text(titleLines, MARGIN_X + pad, cy + 4);
      let innerY = cy + 4 + titleLines.length * 5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(textLines, MARGIN_X + pad, innerY);
      cy += boxH + 4;
      break;
    }
    case 'faq': {
      block.items.forEach((item) => {
        cy = ensureSpace(doc, cy, 12);
        cy += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(17, 24, 39);
        cy = writeWrapped(doc, item.q, MARGIN_X, cy, w, 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        cy = writeWrapped(doc, item.a, MARGIN_X, cy, w, 5.2);
        cy += 4;
      });
      break;
    }
    default:
      break;
  }

  doc.setTextColor(0, 0, 0);
  return cy;
}

function renderContentPage(doc: jsPDF, page: ManualPageDef, pageIndex: number): void {
  let y = MARGIN_TOP;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(37, 99, 235);
  doc.text(page.eyebrow.toUpperCase(), MARGIN_X, y);
  doc.setTextColor(156, 163, 175);
  doc.text(String(pageIndex + 1).padStart(2, '0'), PAGE_WIDTH_MM - MARGIN_X, y, {
    align: 'right',
  });
  y += 9;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  const titleLines = doc.splitTextToSize(page.title, contentWidth(doc)) as string[];
  for (const line of titleLines) {
    y = ensureSpace(doc, y, 8);
    doc.text(line, MARGIN_X, y);
    y += 8;
  }
  y += 5;

  for (const block of page.blocks) {
    y = renderBlock(doc, block, y);
  }
}

/** Genera y descarga el manual en PDF (sin html2canvas). */
export function exportManualToPdf(
  pages: ManualPageDef[],
  cover: ManualCoverMeta,
  fileName: string
): void {
  if (pages.length === 0) {
    throw new Error('El manual no tiene páginas para exportar');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let pdfPageNum = 1;

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();

    if (page.isCover) {
      renderCover(doc, cover);
    } else {
      renderContentPage(doc, page, index);
    }

    drawFooter(doc, pdfPageNum);
    pdfPageNum += 1;
  });

  doc.save(fileName);
}
