'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualPageBody } from '@/components/manual/ManualPageContent';
import type { ManualCoverMeta, ManualPageDef } from '@/lib/manual/types';
import { exportManualToPdf } from '@/lib/manual/export-manual-pdf';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import { cn } from '@/lib/utils';

interface ManualBookShellProps {
  pages: ManualPageDef[];
  cover: ManualCoverMeta;
  pdfFileName: string;
  pdfPreviewTitle: string;
}

export default function ManualBookShell({
  pages,
  cover,
  pdfFileName,
  pdfPreviewTitle,
}: ManualBookShellProps) {
  const notify = useAppNotify();
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1280),
  );
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'prev'>('next');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = viewportWidth < 640;
  const isTablet = viewportWidth < 980;
  const isSinglePageView = isTablet;
  const pagesPerView = isSinglePageView ? 1 : 2;
  const maxPageIndex = Math.max(0, pages.length - pagesPerView);

  useEffect(() => {
    setActivePageIndex((prev) => {
      if (isSinglePageView) return Math.min(prev, pages.length - 1);
      const normalized = Math.min(prev, Math.max(0, pages.length - 2));
      return normalized % 2 === 0 ? normalized : normalized - 1;
    });
  }, [isSinglePageView, pages.length]);

  const goToPage = (index: number) => {
    const normalizedTarget = isSinglePageView ? index : index - (index % 2);
    const clamped = Math.max(0, Math.min(normalizedTarget, maxPageIndex));
    setTurnDirection(clamped >= activePageIndex ? 'next' : 'prev');
    setActivePageIndex(clamped);
  };

  const goNextSpread = () => {
    if (activePageIndex >= maxPageIndex) return;
    setTurnDirection('next');
    setActivePageIndex((prev) => Math.min(prev + pagesPerView, maxPageIndex));
  };

  const goPrevSpread = () => {
    if (activePageIndex <= 0) return;
    setTurnDirection('prev');
    setActivePageIndex((prev) => Math.max(prev - pagesPerView, 0));
  };

  const visiblePages = pages.slice(activePageIndex, activePageIndex + pagesPerView);
  const spreadCount = Math.ceil(pages.length / pagesPerView);
  const currentSpread = Math.floor(activePageIndex / pagesPerView) + 1;

  const handleExportPdf = () => {
    if (isExportingPdf || typeof window === 'undefined') return;
    if (pages.length === 0) {
      notify.error('No hay contenido para exportar.');
      return;
    }

    try {
      setIsExportingPdf(true);
      exportManualToPdf(pages, cover, pdfFileName);
      notify.success('PDF descargado correctamente.');
    } catch (error) {
      console.error('Error exportando PDF del manual:', error);
      const detail = error instanceof Error ? error.message : '';
      notify.error(
        detail
          ? `No se pudo generar el PDF: ${detail}`
          : 'No se pudo generar el PDF. Probá de nuevo.',
        'Error al exportar'
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-gradient-to-b from-gray-50 to-blue-50/40 px-3 py-5 pb-28 dark:from-slate-950 dark:to-slate-900 md:px-6 md:py-8">
      <div className="mx-auto flex w-full min-w-0 max-w-[1380px] flex-col gap-5 md:gap-6">
        {/* Controles superiores */}
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white/90 p-3 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-slate-900/90 md:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Capítulos del manual
                </p>
              </div>
              <span className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                {String(currentSpread).padStart(2, '0')} / {String(spreadCount).padStart(2, '0')}
              </span>
            </div>
            <div
              className="scrollbar-thin-visible max-h-[min(32vh,11.5rem)] min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-0.5"
              aria-label="Capítulos del manual"
            >
              <div className="flex flex-wrap gap-2">
                {pages.map((page, index) => {
                  const isActive = visiblePages.some((p) => p.id === page.id);
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => goToPage(index)}
                      className={cn(
                        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors',
                        isActive
                          ? 'border-blue-700 bg-blue-600 text-white shadow-md'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-200',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black',
                          isActive ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700',
                        )}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 break-words">{page.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="h-auto shrink-0 gap-2 self-start px-4 py-2.5 md:self-center"
          >
            <FileDown className="h-4 w-4" />
            {isExportingPdf ? 'Generando PDF…' : 'Exportar PDF'}
          </Button>
        </div>

        {/* Libro */}
        <div className="relative min-w-0 px-0 md:px-3">
          <div className="pointer-events-none absolute inset-x-[5%] top-5 h-32 rounded-full bg-blue-600/10 blur-2xl" />
          {!isSinglePageView && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 top-5 z-0 w-8 -translate-x-1/2 rounded-full bg-gradient-to-b from-slate-800 via-blue-800 to-slate-800 shadow-lg" />
          )}
          <div
            key={`${activePageIndex}-${pagesPerView}`}
            className={cn(
              'relative z-[1] grid gap-4',
              isSinglePageView ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2 lg:gap-5',
              turnDirection === 'next' ? 'animate-manual-turn-next' : 'animate-manual-turn-prev',
            )}
          >
            {visiblePages.map((page, index) => {
              const isCover = page.isCover === true;
              return (
                <article
                  key={page.id}
                  className={cn(
                    'relative grid max-h-[78vh] min-h-[60vh] grid-rows-[auto_auto_1fr] gap-3 overflow-hidden rounded-2xl border p-4 shadow-lg md:min-h-[70vh] md:rounded-3xl md:p-5 lg:max-h-[76vh]',
                    isCover
                      ? 'border-blue-500/30 bg-gradient-to-br from-slate-800 via-blue-700 to-blue-500 text-white shadow-blue-900/20'
                      : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-slate-900',
                  )}
                >
                  {!isCover && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          {page.eyebrow}
                        </span>
                        <span className="text-xs font-bold text-gray-400">
                          {String(activePageIndex + index + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <h2 className="m-0 text-xl font-bold leading-tight text-gray-900 dark:text-gray-50 md:text-2xl">
                        {page.title}
                      </h2>
                    </>
                  )}
                  <div
                    className={cn(
                      'min-h-0 overflow-y-auto',
                      isCover && 'flex flex-col',
                    )}
                  >
                    <ManualPageBody page={page} cover={cover} />
                  </div>
                  {!isCover && !isMobile && (
                    <div className="pointer-events-none absolute right-0 top-0 h-14 w-14 bg-gradient-to-bl from-blue-100/80 to-transparent dark:from-blue-900/30" />
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {/* Navegación inferior */}
        <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-slate-900/95 md:gap-3 md:p-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={goPrevSpread}
            disabled={activePageIndex <= 0}
            className="w-full justify-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={goNextSpread}
            disabled={activePageIndex >= maxPageIndex}
            className="w-full justify-center gap-1"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
