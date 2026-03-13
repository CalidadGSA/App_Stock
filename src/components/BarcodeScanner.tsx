'use client';

/**
 * BarcodeScanner - Componente de lectura de código de barras.
 *
 * Soporta dos modos:
 *   1. Input de texto (modo principal): compatible con lectores USB tipo teclado y PDAs.
 *      El campo se mantiene enfocado automáticamente después de cada lectura.
 *   2. Cámara (@zxing/browser): activo solo cuando el usuario lo solicita.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ScanBarcode } from 'lucide-react';
import { Button } from './ui/button';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Si true, mantiene el foco en el input del escáner (ideal para lector USB). */
  autoFocusInput?: boolean;
  /** Si true, captura lecturas del escáner globalmente para evitar que se escriban en otros inputs. */
  captureGlobally?: boolean;
}

export default function BarcodeScanner({
  onScan,
  disabled,
  placeholder = 'Escanear código de barras...',
  autoFocusInput = true,
  captureGlobally = false,
}: BarcodeScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const readerRef = useRef<unknown>(null);
  const globalBufferRef = useRef('');
  const globalTimerRef = useRef<number | null>(null);

  // Mantener el input enfocado (para lector USB / PDA)
  const refocus = useCallback(() => {
    if (!autoFocusInput) return;
    if (!cameraActive && inputRef.current && !disabled) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [autoFocusInput, cameraActive, disabled]);

  useEffect(() => {
    refocus();
  }, [refocus]);

  useEffect(() => {
    if (!captureGlobally || disabled || cameraActive) return;

    function clearBuffer() {
      globalBufferRef.current = '';
      if (globalTimerRef.current != null) {
        window.clearTimeout(globalTimerRef.current);
        globalTimerRef.current = null;
      }
    }

    function scheduleClear() {
      if (globalTimerRef.current != null) {
        window.clearTimeout(globalTimerRef.current);
      }
      globalTimerRef.current = window.setTimeout(() => {
        clearBuffer();
      }, 150);
    }

    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === 'Enter') {
        const barcode = globalBufferRef.current.trim();
        if (barcode) {
          e.preventDefault();
          e.stopPropagation();
          clearBuffer();
          onScan(barcode);
        }
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        globalBufferRef.current += e.key;
        scheduleClear();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      clearBuffer();
    };
  }, [captureGlobally, disabled, cameraActive, onScan]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Los lectores USB envían Enter al finalizar la lectura
    if (e.key === 'Enter' && inputValue.trim()) {
      const barcode = inputValue.trim();
      setInputValue('');
      onScan(barcode);
      refocus();
    }
  }

  async function startCamera() {
    setCameraError(null);
    setCameraActive(true);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      if (videoRef.current) {
        await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (result) {
            const barcode = result.getText();
            stopCamera();
            onScan(barcode);
          }
        });
      }
    } catch (err) {
      console.error('[BarcodeScanner camera]', err);
      setCameraError('No se pudo acceder a la cámara. Verificar permisos.');
      setCameraActive(false);
    }
  }

  function stopCamera() {
    try {
      if (readerRef.current) {
        const reader = readerRef.current as { reset?: () => void };
        reader.reset?.();
        readerRef.current = null;
      }
    } catch { /* ignorar */ }
    setCameraActive(false);
    refocus();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Input principal para lector USB/PDA */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={autoFocusInput ? refocus : undefined}
            disabled={disabled || cameraActive}
            placeholder={placeholder}
            className="w-full rounded-xl border-2 border-blue-200 bg-blue-50 pl-10 pr-4 py-4 text-lg font-mono
              focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
              disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400"
            autoFocus={autoFocusInput}
            autoComplete="off"
            inputMode="none"
          />
        </div>
        <Button
          type="button"
          variant={cameraActive ? 'danger' : 'outline'}
          size="lg"
          onClick={cameraActive ? stopCamera : startCamera}
          disabled={disabled}
          title={cameraActive ? 'Detener cámara' : 'Usar cámara'}
          className="shrink-0"
        >
          {cameraActive ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        </Button>
      </div>

      {/* Visor de cámara */}
      {cameraActive && (
        <div className="overflow-hidden rounded-xl border-2 border-blue-300 bg-black">
          <video
            ref={videoRef}
            className="w-full max-h-64 object-cover"
            autoPlay
            muted
            playsInline
          />
          <p className="px-3 py-2 text-center text-xs text-white/70">
            Apuntar la cámara al código de barras
          </p>
        </div>
      )}

      {cameraError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{cameraError}</p>
      )}

      <p className="text-xs text-gray-400 text-center">
        Leer con escáner USB/PDA · También podés usar la cámara con el botón
      </p>
    </div>
  );
}
