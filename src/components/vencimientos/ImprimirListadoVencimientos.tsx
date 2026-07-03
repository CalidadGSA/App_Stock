'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { esperarRenderImpresion } from '@/lib/list/preparar-impresion';

export const VENCIMIENTOS_PRINT_AREA_ATTR = 'data-vencimientos-print-area';

/** Botón que dispara impresión del bloque marcado con `data-vencimientos-print-area`. */
export function BotonImprimirListadoVencimientos({
  disabled,
  className,
  onPreparePrint,
}: {
  disabled?: boolean;
  className?: string;
  /** Cargar todos los registros (p. ej. sin paginación) antes de imprimir. */
  onPreparePrint?: () => Promise<void>;
}) {
  const [preparing, setPreparing] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || preparing}
      loading={preparing}
      className={className}
      onClick={() => {
        void (async () => {
          let puedeImprimir = true;
          if (onPreparePrint) {
            setPreparing(true);
            try {
              await onPreparePrint();
              await esperarRenderImpresion();
            } catch {
              puedeImprimir = false;
            } finally {
              setPreparing(false);
            }
          }
          if (puedeImprimir) window.print();
        })();
      }}
    >
      <Printer className="mr-1.5 h-4 w-4" />
      Imprimir
    </Button>
  );
}

/** Encabezado visible solo al imprimir el listado. */
export function EncabezadoImpresionListadoVencimientos({
  titulo,
  detalle,
  cantidadRegistros,
}: {
  titulo: string;
  detalle?: string;
  cantidadRegistros: number;
}) {
  const generado = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return (
    <div className="datatable-print-header mb-2 border-b border-gray-300 pb-2">
      <h1 className="text-sm font-bold text-gray-900">{titulo}</h1>
      {detalle ? <p className="mt-0.5 text-xs text-gray-700">{detalle}</p> : null}
      <p className="mt-0.5 text-[10px] text-gray-600">
        Registros: {cantidadRegistros} · Generado: {generado}
      </p>
    </div>
  );
}
