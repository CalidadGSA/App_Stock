'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, CheckCircle2, Snowflake, Trash2, TrendingUp, TrendingDown, Minus, Camera, CameraOff } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import { inferirTipoControlInventario } from '@/lib/inventario/tipo-control';
import type { ControlInventario, ControlInventarioDetalle, ProductoLegacy } from '@/types';

interface ControlConDetalles extends ControlInventario {
  controles_inventario_detalle: ControlInventarioDetalle[];
}

function normalizeBarcode(value: string | null | undefined) {
  return (value ?? '').trim();
}

function productoAceptaBarcode(producto: ProductoLegacy | null, barcode: string) {
  if (!producto) return false;

  const scanned = normalizeBarcode(barcode);
  if (!scanned) return false;

  const codigos = new Set([
    normalizeBarcode(producto.codigo_barras),
    ...(producto.codigos_secundarios ?? []).map(normalizeBarcode),
  ]);

  codigos.delete('');
  return codigos.has(scanned);
}

function detalleCoincideConBarcode(detalle: ControlInventarioDetalle, barcode: string) {
  return normalizeBarcode(detalle.codigo_barras) === normalizeBarcode(barcode);
}

export default function InventarioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [control, setControl] = useState<ControlConDetalles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Estado del producto escaneado
  const [productoEscaneado, setProductoEscaneado] = useState<ProductoLegacy | null>(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [errorProducto, setErrorProducto] = useState('');
  const [stockRealCajas, setStockRealCajas] = useState('');
  const [stockRealUnidades, setStockRealUnidades] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [detalleSeleccionadoId, setDetalleSeleccionadoId] = useState<string | null>(null);
  const [filtroCodigo, setFiltroCodigo] = useState<string>('');
  const [filtroNombre, setFiltroNombre] = useState<string>('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<
    { producto_id_sistema: string; codigo_barras: string | null; descripcion: string; presentacion: string | null; laboratorio: string | null }[]
  >([]);
  const [buscandoEnMedicamentos, setBuscandoEnMedicamentos] = useState(false);
  const [refrigeradoByBarcode, setRefrigeradoByBarcode] = useState<Record<string, boolean>>({});
  const [editandoCard, setEditandoCard] = useState(false);
  const [cardCameraActive, setCardCameraActive] = useState(false);
  const [cardCameraError, setCardCameraError] = useState('');
  const cardCameraVideoRef = useRef<HTMLVideoElement>(null);
  const cardCameraReaderRef = useRef<unknown>(null);
  const cardCameraSessionRef = useRef(0);
  const cardCameraLockedRef = useRef(false);
  const cardCameraLastScanRef = useRef<{ value: string; at: number } | null>(null);
  const cardCameraVisibleBarcodeRef = useRef<string | null>(null);
  const cardCameraLastValidMsRef = useRef(0);
  const cardCameraSuppressUntilRef = useRef(0);
  const cardCameraArmedRef = useRef(true);
  const inputCajasRef = useRef<HTMLInputElement>(null);
  const inputUnidadesRef = useRef<HTMLInputElement>(null);
  const ultimoKeyMsRef = useRef(0);
  const scannerBufferRef = useRef('');
  const scannerEnInputRef = useRef(false);
  const baselineCajasRef = useRef('');
  const baselineUnidadesRef = useRef('');
  const sequenceStartCajasRef = useRef('');
  const sequenceStartUnidadesRef = useRef('');
  const pendingManualTimerRef = useRef<number | null>(null);
  const pendingManualFieldRef = useRef<'cajas' | 'unidades' | null>(null);
  const scanRequestIdRef = useRef(0);
  const scanAbortRef = useRef<AbortController | null>(null);
  const lastConfirmedBarcodeRef = useRef<{ value: string; at: number } | null>(null);
  const mustScanDifferentBarcodeRef = useRef<string | null>(null);
  const recentlyConfirmedBarcodesRef = useRef<Map<string, number>>(new Map());

  // Índice local para acelerar búsquedas por nombre en inventario diario guiado.
  const indiceBusquedaDiaria = useMemo(() => {
    return (control?.controles_inventario_detalle ?? []).map((d) => ({
      detalle: d,
      texto: `${d.descripcion ?? ''} ${d.presentacion ?? ''}`.toLowerCase(),
    }));
  }, [control?.controles_inventario_detalle]);

  useEffect(() => {
    async function cargarRefrigerados() {
      const detalles = control?.controles_inventario_detalle ?? [];
      const barcodes = Array.from(
        new Set(
          detalles
            .map((d) => (d.codigo_barras ?? '').trim())
            .filter((b) => b.length > 0)
        )
      );
      const faltantes = barcodes.filter((bc) => refrigeradoByBarcode[bc] === undefined);
      if (faltantes.length === 0) return;

      const nuevos: Record<string, boolean> = {};
      for (const bc of faltantes) {
        try {
          const res = await fetch(`/api/productos/basico/${encodeURIComponent(bc)}`);
          const json = (await res.json()) as { data?: ProductoLegacy };
          nuevos[bc] = !!json.data?.refrigerado;
        } catch {
          nuevos[bc] = false;
        }
      }
      setRefrigeradoByBarcode((prev) => ({ ...prev, ...nuevos }));
    }

    if (control) {
      void cargarRefrigerados();
    }
  }, [control, refrigeradoByBarcode]);

  function handleChangeStockRealCajas(value: string) {
    if (value === '') {
      setStockRealCajas('');
      baselineCajasRef.current = '';
      return;
    }
    // Solo permitir enteros de hasta 4 dígitos; evita que un barcode quede escrito literal.
    if (!/^\d{1,4}$/.test(value)) {
      if (value.replace(/\D/g, '').length > 4) {
        setErrorProducto('Se detectó una lectura de código. Ese valor no se carga en el campo de cajas.');
      }
      return;
    }
    setErrorProducto('');
    setStockRealCajas(value);
    if (!scannerEnInputRef.current) {
      baselineCajasRef.current = value;
    }
  }

  function handleChangeStockRealUnidades(value: string) {
    if (value === '') {
      setStockRealUnidades('');
      baselineUnidadesRef.current = '';
      return;
    }
    // Solo permitir enteros de hasta 3 dígitos; evita que un barcode quede escrito literal.
    if (!/^\d{1,3}$/.test(value)) {
      if (value.replace(/\D/g, '').length > 3) {
        setErrorProducto('Se detectó una lectura de código. Ese valor no se carga en el campo de unidades.');
      }
      return;
    }
    setErrorProducto('');
    setStockRealUnidades(value);
    if (!scannerEnInputRef.current) {
      baselineUnidadesRef.current = value;
    }
  }

  function resetScannerInputCapture() {
    ultimoKeyMsRef.current = 0;
    scannerBufferRef.current = '';
    scannerEnInputRef.current = false;
    sequenceStartCajasRef.current = '';
    sequenceStartUnidadesRef.current = '';
    if (pendingManualTimerRef.current != null) {
      window.clearTimeout(pendingManualTimerRef.current);
      pendingManualTimerRef.current = null;
    }
    pendingManualFieldRef.current = null;
  }

  function setFieldValue(field: 'cajas' | 'unidades', value: string) {
    if (field === 'cajas') {
      setStockRealCajas(value);
      baselineCajasRef.current = value;
      if (inputCajasRef.current) inputCajasRef.current.value = value;
    } else {
      setStockRealUnidades(value);
      baselineUnidadesRef.current = value;
      if (inputUnidadesRef.current) inputUnidadesRef.current.value = value;
    }
  }

  function handleCardInputFocus(field: 'cajas' | 'unidades') {
    setEditandoCard(true);
    if (field === 'cajas') {
      baselineCajasRef.current = stockRealCajas;
    } else {
      baselineUnidadesRef.current = stockRealUnidades;
    }
    resetScannerInputCapture();
  }

  function handleCardInputBlur() {
    setEditandoCard(false);
    resetScannerInputCapture();
  }

  function handleCardInputKeyDown(
    field: 'cajas' | 'unidades',
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (!productoEscaneado) return;

    const isDigit = /^\d$/.test(e.key);
    const isEnter = e.key === 'Enter';
    const now = Date.now();

    if (isDigit) {
      e.preventDefault();
      e.stopPropagation();

      const delta = ultimoKeyMsRef.current === 0 ? Number.POSITIVE_INFINITY : now - ultimoKeyMsRef.current;
      ultimoKeyMsRef.current = now;
      const thresholdMs = 20;
      const manualCommitDelayMs = 35;

      // Guardamos el valor al inicio de una nueva secuencia de teclas.
      if (scannerBufferRef.current.length === 0) {
        if (field === 'cajas') {
          sequenceStartCajasRef.current = stockRealCajas;
        } else {
          sequenceStartUnidadesRef.current = stockRealUnidades;
        }
      }

      // Si detectamos una secuencia extremadamente rápida, asumimos que es el escáner
      if (!scannerEnInputRef.current && scannerBufferRef.current.length > 0 && delta < thresholdMs) {
        scannerEnInputRef.current = true;
        if (pendingManualTimerRef.current != null) {
          window.clearTimeout(pendingManualTimerRef.current);
          pendingManualTimerRef.current = null;
        }
        pendingManualFieldRef.current = null;
        if (field === 'cajas') {
          setStockRealCajas(sequenceStartCajasRef.current);
          if (inputCajasRef.current) {
            inputCajasRef.current.value = sequenceStartCajasRef.current;
          }
        } else {
          setStockRealUnidades(sequenceStartUnidadesRef.current);
          if (inputUnidadesRef.current) {
            inputUnidadesRef.current.value = sequenceStartUnidadesRef.current;
          }
        }
      }

      scannerBufferRef.current += e.key;

      // Si todavía no parece escáner, diferimos un instante la escritura manual.
      // Así evitamos que el primer dígito del barcode llegue a verse en el campo.
      if (!scannerEnInputRef.current) {
        if (pendingManualTimerRef.current != null) {
          window.clearTimeout(pendingManualTimerRef.current);
        }
        pendingManualFieldRef.current = field;
        const current = field === 'cajas' ? stockRealCajas : stockRealUnidades;
        const maxDigits = field === 'cajas' ? 4 : 3;
        const next = `${current}${e.key}`.slice(0, maxDigits);
        pendingManualTimerRef.current = window.setTimeout(() => {
          if (!scannerEnInputRef.current && pendingManualFieldRef.current === field) {
            setFieldValue(field, next);
            scannerBufferRef.current = '';
            ultimoKeyMsRef.current = 0;
          }
          pendingManualTimerRef.current = null;
          pendingManualFieldRef.current = null;
        }, manualCommitDelayMs);
      }
      return;
    }

    if (isEnter && scannerEnInputRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const barcode = scannerBufferRef.current.trim();
      resetScannerInputCapture();
      setEditandoCard(false);
      if (field === 'cajas') {
        inputCajasRef.current?.blur();
      } else {
        inputUnidadesRef.current?.blur();
      }
      if (barcode) {
        void handleScan(barcode);
      }
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      resetScannerInputCapture();
      const current = field === 'cajas' ? stockRealCajas : stockRealUnidades;
      setFieldValue(field, current.slice(0, -1));
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      resetScannerInputCapture();
      setFieldValue(field, '');
      return;
    }

    if (
      !isEnter &&
      !['ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)
    ) {
      resetScannerInputCapture();
    }
  }

  async function startCardCamera() {
    if (!productoEscaneado) return;
    setCardCameraError('');
    setCardCameraActive(true);
    const sessionId = cardCameraSessionRef.current + 1;
    cardCameraSessionRef.current = sessionId;
    cardCameraSuppressUntilRef.current = Date.now() + 180;
    cardCameraLockedRef.current = false;
    cardCameraVisibleBarcodeRef.current = null;
    cardCameraLastValidMsRef.current = 0;
    cardCameraArmedRef.current = true;
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      cardCameraReaderRef.current = reader;
      if (cardCameraVideoRef.current) {
        await reader.decodeFromVideoDevice(undefined, cardCameraVideoRef.current, (result) => {
          if (sessionId !== cardCameraSessionRef.current) return;
          if (Date.now() < cardCameraSuppressUntilRef.current) return;
          if (!result) {
            // Re-armado robusto: solo tras ausencia sostenida de lectura.
            if (Date.now() - cardCameraLastValidMsRef.current > 350) {
              cardCameraVisibleBarcodeRef.current = null;
              cardCameraArmedRef.current = true;
            }
            return;
          }
          if (cardCameraLockedRef.current || !productoEscaneado) return;
          const barcode = result.getText().trim();
          if (!barcode) return;
          cardCameraLastValidMsRef.current = Date.now();

          const now = Date.now();
          const prev = cardCameraLastScanRef.current;
          // Evita lecturas duplicadas del mismo frame.
          if (prev && prev.value === barcode && now - prev.at < 1000) return;
          cardCameraLastScanRef.current = { value: barcode, at: now };

          if (!productoAceptaBarcode(productoEscaneado, barcode)) {
            setErrorProducto('Este código no pertenece al producto seleccionado.');
            return;
          }
          // Anti-bucle: mientras siga visible el mismo código, no vuelve a sumar.
          if (cardCameraVisibleBarcodeRef.current === barcode) {
            return;
          }
          cardCameraVisibleBarcodeRef.current = barcode;
          if (!cardCameraArmedRef.current) {
            // Mismo código sostenido en cámara: ignorar hasta perder lectura.
            return;
          }

          cardCameraLockedRef.current = true;
          cardCameraArmedRef.current = false;
          setStockRealCajas((prevCajas) => String((parseInt(prevCajas || '0', 10) || 0) + 1));
          setTimeout(() => {
            cardCameraLockedRef.current = false;
          }, 250);
        });
      }
    } catch {
      setCardCameraError('No se pudo acceder a la cámara.');
      setCardCameraActive(false);
    }
  }

  function stopCardCamera() {
    cardCameraSessionRef.current += 1;
    cardCameraSuppressUntilRef.current = Date.now() + 180;
    try {
      if (cardCameraReaderRef.current) {
        const reader = cardCameraReaderRef.current as { reset?: () => void };
        reader.reset?.();
        cardCameraReaderRef.current = null;
      }
    } catch {
      // ignore
    }
    cardCameraLockedRef.current = false;
    cardCameraVisibleBarcodeRef.current = null;
    cardCameraLastValidMsRef.current = 0;
    cardCameraArmedRef.current = true;
    setCardCameraActive(false);
  }

  const cargarControl = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventario/${id}`);
      const json = await res.json() as { data?: ControlConDetalles; error?: string };
      if (!res.ok) { setError(json.error ?? 'Error al cargar'); return; }
      setControl(json.data!);
    } catch {
      setError('Error al cargar el control');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargarControl(); }, [cargarControl]);

  useEffect(() => {
    return () => {
      stopCardCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!productoEscaneado) return;

    function targetField(target: EventTarget | null): 'cajas' | 'unidades' | null {
      if (!(target instanceof HTMLElement)) return null;
      if (inputCajasRef.current && target === inputCajasRef.current) return 'cajas';
      if (inputUnidadesRef.current && target === inputUnidadesRef.current) return 'unidades';
      return null;
    }

    function handleGlobalInputCapture(e: KeyboardEvent) {
      const field = targetField(e.target);
      if (!field) return;

      const isDigit = /^\d$/.test(e.key);
      const isEnter = e.key === 'Enter';
      const isBackspace = e.key === 'Backspace';
      const isDelete = e.key === 'Delete';
      const allowedNav = ['ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];

      if (!isDigit && !isEnter && !isBackspace && !isDelete && !allowedNav.includes(e.key)) {
        return;
      }

      // Interceptar antes de que el navegador escriba nada en el input
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      const delta = ultimoKeyMsRef.current === 0 ? Number.POSITIVE_INFINITY : now - ultimoKeyMsRef.current;

      if (isDigit) {
        ultimoKeyMsRef.current = now;
        const thresholdMs = 20;
        const manualCommitDelayMs = 35;

        if (scannerBufferRef.current.length === 0) {
          if (field === 'cajas') {
            sequenceStartCajasRef.current = stockRealCajas;
          } else {
            sequenceStartUnidadesRef.current = stockRealUnidades;
          }
        }

        if (!scannerEnInputRef.current && scannerBufferRef.current.length > 0 && delta < thresholdMs) {
          scannerEnInputRef.current = true;
          if (pendingManualTimerRef.current != null) {
            window.clearTimeout(pendingManualTimerRef.current);
            pendingManualTimerRef.current = null;
          }
          pendingManualFieldRef.current = null;
          if (field === 'cajas') {
            setFieldValue('cajas', sequenceStartCajasRef.current);
          } else {
            setFieldValue('unidades', sequenceStartUnidadesRef.current);
          }
        }

        scannerBufferRef.current += e.key;

        if (!scannerEnInputRef.current) {
          if (pendingManualTimerRef.current != null) {
            window.clearTimeout(pendingManualTimerRef.current);
          }
          pendingManualFieldRef.current = field;
          const current = field === 'cajas' ? stockRealCajas : stockRealUnidades;
          const maxDigits = field === 'cajas' ? 4 : 3;
          const next = `${current}${e.key}`.slice(0, maxDigits);
          pendingManualTimerRef.current = window.setTimeout(() => {
            if (!scannerEnInputRef.current && pendingManualFieldRef.current === field) {
              setFieldValue(field, next);
              scannerBufferRef.current = '';
              ultimoKeyMsRef.current = 0;
            }
            pendingManualTimerRef.current = null;
            pendingManualFieldRef.current = null;
          }, manualCommitDelayMs);
        }
        return;
      }

      if (isEnter && scannerEnInputRef.current) {
        const barcode = scannerBufferRef.current.trim();
        resetScannerInputCapture();
        setEditandoCard(false);
        if (field === 'cajas') {
          inputCajasRef.current?.blur();
        } else {
          inputUnidadesRef.current?.blur();
        }
        if (barcode) {
          void handleScan(barcode);
        }
        return;
      }

      if (isBackspace) {
        resetScannerInputCapture();
        const current = field === 'cajas' ? stockRealCajas : stockRealUnidades;
        setFieldValue(field, current.slice(0, -1));
        return;
      }

      if (isDelete) {
        resetScannerInputCapture();
        setFieldValue(field, '');
      }
    }

    window.addEventListener('keydown', handleGlobalInputCapture, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalInputCapture, true);
    };
  }, [
    productoEscaneado,
    stockRealCajas,
    stockRealUnidades,
  ]);

  async function cargarProductoParaDetalle(
    detalle: ControlInventarioDetalle,
    canApply: () => boolean = () => true,
    signal?: AbortSignal
  ) {
    // Solo abrimos la card si pudimos obtener el stock actual.
    try {
      const res = await fetch(`/api/productos/id/${encodeURIComponent(detalle.producto_id_sistema)}`, { signal });
      const json = await res.json() as { data?: ProductoLegacy; error?: string };
      if (!canApply()) return false;
      if (res.ok && json.data) {
        const prod = json.data;
        if (!canApply()) return false;
        setProductoEscaneado(prod);
        setStockRealCajas(
          detalle.stock_real_cajas != null ? String(detalle.stock_real_cajas) : ''
        );
        setStockRealUnidades(
          detalle.stock_real_unidades != null ? String(detalle.stock_real_unidades) : ''
        );
        return true;
      }
      if (!canApply()) return false;
      setProductoEscaneado(null);
      setStockRealCajas('');
      setStockRealUnidades('');
      setErrorProducto(
        json.error ??
          'No se pudo consultar el stock del sistema. Volvé a intentar para evitar contar con datos incorrectos.'
      );
      return false;
    } catch {
      if (signal?.aborted) return false;
      if (!canApply()) return false;
      setProductoEscaneado(null);
      setStockRealCajas('');
      setStockRealUnidades('');
      setErrorProducto(
        'No se pudo consultar el stock del sistema. Volvé a intentar para evitar contar con datos incorrectos.'
      );
      return false;
    }
  }

  async function handleScan(barcode: string): Promise<boolean> {
    const requestId = ++scanRequestIdRef.current;
    const isStale = () => requestId !== scanRequestIdRef.current;
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;
    const signal = controller.signal;
    setErrorProducto('');

    const query = barcode.trim();
    if (!query) return false;
    const esBarcode = !/[a-zA-Z]/.test(query);
    // Prioridad alta: si el producto ya está en el inventario, reabrir su card.
    // Esto debe ocurrir antes de filtros anti-rebote.
    if (esBarcode && !productoEscaneado) {
      const detalleExistentePorBarcode =
        (control?.controles_inventario_detalle ?? []).find((d) => d.codigo_barras === query) ?? null;
      if (detalleExistentePorBarcode) {
        const opened = await cargarProductoParaDetalle(detalleExistentePorBarcode, () => !isStale(), signal);
        if (isStale()) return false;
        if (opened) {
          setDetalleSeleccionadoId(detalleExistentePorBarcode.id);
          if (control?.categoria_macro) {
            setFiltroCodigo(detalleExistentePorBarcode.codigo_barras);
          }
        }
        return opened;
      }
    }
    const now = Date.now();
    // Ignorar códigos recién confirmados (rebote/residuo de cámara).
    // Se limpia automáticamente por tiempo para no bloquear edición normal.
    const recentTs = recentlyConfirmedBarcodesRef.current.get(query);
    if (recentTs && now - recentTs < 4000) {
      return false;
    }
    for (const [code, ts] of recentlyConfirmedBarcodesRef.current.entries()) {
      if (now - ts >= 4000) {
        recentlyConfirmedBarcodesRef.current.delete(code);
      }
    }
    // Después de confirmar una card, exigimos un código distinto al anterior
    // para evitar reaperturas fantasma por rebote/residuo de cámara.
    if (mustScanDifferentBarcodeRef.current && query === mustScanDifferentBarcodeRef.current) {
      return false;
    }
    if (mustScanDifferentBarcodeRef.current && query !== mustScanDifferentBarcodeRef.current) {
      mustScanDifferentBarcodeRef.current = null;
    }
    const lastConfirmed = lastConfirmedBarcodeRef.current;
    // Evita rebote de cámara: justo después de confirmar, puede reemitir el último código.
    if (lastConfirmed && query === lastConfirmed.value && now - lastConfirmed.at < 1500) {
      return false;
    }
    if (esBarcode) {
      setResultadosBusqueda([]);
    }

    // Si hay una card abierta, no permitir usar el buscador para cambiar de producto.
    // Solo se permiten nuevos escaneos numéricos del mismo producto (ya manejados más abajo).
    if (productoEscaneado && /[a-zA-Z]/.test(query)) {
      setErrorProducto('Cerrá la card del producto actual antes de buscar otro.');
      return false;
    }

    // Si contiene letras y es un inventario guiado (diario con categoria_macro),
    // filtramos solo dentro de la lista preasignada.
    if (/[a-zA-Z]/.test(query)) {
      // Con categoría macro (inventario diario guiado): solo buscar dentro de los productos asignados.
      if (esControlGuiado) {
        const q = query.toLowerCase();
        const coincidencias = indiceBusquedaDiaria.filter((i) => i.texto.includes(q));

        if (coincidencias.length === 0) {
          setErrorProducto('No se encontraron productos con ese nombre en este control.');
          setFiltroNombre('');
          return false;
        } else {
          setFiltroNombre(query);
          setDetalleSeleccionadoId(null);
          setProductoEscaneado(null);
          setStockRealCajas('');
          setStockRealUnidades('');
          return true;
        }
        setBuscandoProducto(false);
      }

      // En inventarios ocasionales / auditoría: buscar directamente en medicamentos.
      setBuscandoEnMedicamentos(true);
      setResultadosBusqueda([]);
      try {
        const params = new URLSearchParams({ q: query });
        const res = await fetch(`/api/productos/buscar?${params.toString()}`, { signal });
        if (isStale()) return false;
        const json = await res.json() as {
          data?: {
            producto_id_sistema: string;
            codigo_barras: string | null;
            descripcion: string;
            presentacion: string | null;
            laboratorio: string | null;
          }[];
          error?: string;
        };
        if (!res.ok) {
          if (isStale()) return false;
          setErrorProducto(json.error ?? 'Error al buscar productos en medicamentos.');
        } else {
          if (isStale()) return false;
          const lista = json.data ?? [];
          setResultadosBusqueda(lista);
          if (lista.length === 0) {
            setErrorProducto('No se encontraron productos en medicamentos para esa búsqueda.');
            return false;
          }
          return true;
        }
      } catch {
        if (signal.aborted) return false;
        if (isStale()) return false;
        setErrorProducto('Error al buscar productos en medicamentos.');
        return false;
      } finally {
        if (isStale()) return false;
        setBuscandoEnMedicamentos(false);
      }

      setBuscandoProducto(false);
      return false;
    }

    // Si la card está abierta, cualquier barcode del mismo producto suma 1 caja.
    if (productoEscaneado) {
      if (productoAceptaBarcode(productoEscaneado, barcode)) {
        setStockRealCajas((prev) => String((parseInt(prev || '0', 10) || 0) + 1));
        return true;
      } else {
        setErrorProducto('Este código no pertenece al producto seleccionado.');
        return false;
      }
    }

    setProductoEscaneado(null);
    setStockRealCajas('');
    setStockRealUnidades('');
      stopCardCamera();
    setBuscandoProducto(true);

    // En inventarios diarios con categoría macro (FARMA/BIENESTAR/PSICOTROPICOS),
    // el escaneo solo sirve para ubicar un producto ya registrado, sin agregar líneas nuevas.
    if (control?.categoria_macro) {
      const detallesControl = control.controles_inventario_detalle ?? [];
      let detalle = detallesControl.find((d) => d.codigo_barras === barcode) ?? null;

      if (!detalle) {
        try {
          const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`, { signal });
          if (signal.aborted) return false;
          if (isStale()) return false;
          const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
          if (res.ok && json.data) {
            detalle =
              detallesControl.find(
                (d) => d.producto_id_sistema === json.data?.producto_id_sistema
              ) ?? null;
          }
        } catch {
          // Si falla esta resolución extra, dejamos el mismo mensaje estándar.
        }
      }

      if (!detalle) {
        setErrorProducto('Este producto no forma parte de los productos asignados a este inventario diario.');
        setBuscandoProducto(false);
        return false;
      }

      const cargado = await cargarProductoParaDetalle(detalle, () => !isStale(), signal);
      if (isStale()) return false;
      if (cargado) {
        setDetalleSeleccionadoId(detalle.id);
        setFiltroCodigo(detalle.codigo_barras);
      } else {
        setDetalleSeleccionadoId(null);
        setFiltroCodigo('');
      }
      setBuscandoProducto(false);
      return cargado;
    }

    async function fetchProducto(intento: number): Promise<boolean> {
      try {
        const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`, { signal });
        if (signal.aborted) return false;
        if (isStale()) return false;
        const json = (await res.json()) as { data?: ProductoLegacy; error?: string };

        if (!res.ok) {
          if (isStale()) return false;
          // Si es el primer intento y hay error de servidor/red, reintentar una vez.
          if (intento === 1 && (res.status >= 500 || res.status === 408)) {
            return fetchProducto(2);
          }
          setErrorProducto(json.error ?? 'Producto no encontrado');
          return false;
        }
        const producto = json.data!;
        const detallesControl = control?.controles_inventario_detalle ?? [];
        const detalleExistente =
          detallesControl.find(
            (d) => d.producto_id_sistema === producto.producto_id_sistema
          ) ??
          detallesControl.find((d) => detalleCoincideConBarcode(d, barcode)) ??
          null;

        if (isStale()) return false;
        setProductoEscaneado(producto);

        if (detalleExistente) {
          setDetalleSeleccionadoId(detalleExistente.id);
          setStockRealCajas(
            detalleExistente.stock_real_cajas != null
              ? String(detalleExistente.stock_real_cajas)
              : ''
          );
          setStockRealUnidades(
            detalleExistente.stock_real_unidades != null
              ? String(detalleExistente.stock_real_unidades)
              : ''
          );
        } else {
          setDetalleSeleccionadoId(null);
          setStockRealCajas('');
          setStockRealUnidades('');
        }
        return true;
      } catch {
        if (signal.aborted) return false;
        if (isStale()) return false;
        if (intento === 1) {
          return fetchProducto(2);
        }
        setErrorProducto('Error al buscar el producto');
        return false;
      }
    }

    const encontrado = await fetchProducto(1);
    if (isStale()) return false;
    setBuscandoProducto(false);
    return encontrado;
  }

  async function handleAgregarDesdeBusqueda(resultado: {
    producto_id_sistema: string;
    codigo_barras: string | null;
  }) {
    setErrorProducto('');
    scanAbortRef.current?.abort();
    scanRequestIdRef.current += 1;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    const signal = controller.signal;

    // 1) Si ya existe en el inventario por ID, reabrimos su card por ID.
    const detalleExistente =
      (control?.controles_inventario_detalle ?? []).find(
        (d) => d.producto_id_sistema === resultado.producto_id_sistema
      ) ?? null;

    if (detalleExistente) {
      const opened = await cargarProductoParaDetalle(detalleExistente, () => true, signal);
      if (opened) {
        setDetalleSeleccionadoId(detalleExistente.id);
        if (control?.categoria_macro) {
          setFiltroCodigo(detalleExistente.codigo_barras);
        }
        setResultadosBusqueda([]);
      }
      return;
    }

    // 2) Si no existe aún, intentamos abrir por ID de producto.
    try {
      const res = await fetch(
        `/api/productos/id/${encodeURIComponent(resultado.producto_id_sistema)}`,
        { signal }
      );
      const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
      if (!res.ok || !json.data) {
        setErrorProducto(json.error ?? 'No se pudo cargar el producto por ID.');
        return;
      }

      const producto = json.data;
      setProductoEscaneado(producto);
      setDetalleSeleccionadoId(null);
      setStockRealCajas('');
      setStockRealUnidades('');
      setResultadosBusqueda([]);
      return;
    } catch {
      // 3) Fallback final: usar barcode si existe.
      if (resultado.codigo_barras) {
        await handleScan(resultado.codigo_barras);
        return;
      }
      setErrorProducto('No se pudo cargar el producto seleccionado.');
    }
  }

  async function handleGuardarLinea() {
    if (!productoEscaneado) return;
    // Cancelar cualquier lookup pendiente para que no reabra cards viejas.
    scanAbortRef.current?.abort();
    scanRequestIdRef.current += 1;
    // Antes de guardar, validar que el stock de sistema no haya cambiado mientras se hacía el conteo
    if (control?.categoria_macro) {
      try {
        const res = await fetch(
          `/api/productos/id/${encodeURIComponent(productoEscaneado.producto_id_sistema)}`
        );
        const json = (await res.json()) as { data?: ProductoLegacy; error?: string };
        if (res.ok && json.data) {
          const nuevo = json.data;
          const cajasPrevias = productoEscaneado.stock_cajas ?? 0;
          const unidadesPrevias = productoEscaneado.stock_unidades ?? 0;
          const cajasNuevas = nuevo.stock_cajas ?? 0;
          const unidadesNuevas = nuevo.stock_unidades ?? 0;

          if (cajasPrevias !== cajasNuevas || unidadesPrevias !== unidadesNuevas) {
            setErrorProducto(
              'El stock del sistema cambió mientras se hacía el conteo. Revisá nuevamente antes de confirmar.'
            );
            return;
          }
        }
      } catch {
        // Si falla la validación, permitimos continuar; solo evitamos fallar silenciosamente
      }
    }

    const cajasNum =
      stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
    const unidadesNum =
      stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);

    if (isNaN(cajasNum) || cajasNum < 0) {
      setErrorProducto('Ingresá una cantidad válida de cajas (>= 0)');
      return;
    }
    if (cajasNum > 6000) {
      setErrorProducto('El stock físico en cajas no puede ser mayor a 6000.');
      return;
    }
    if (isNaN(unidadesNum) || unidadesNum < 0) {
      setErrorProducto('Ingresá una cantidad válida de unidades (>= 0)');
      return;
    }
    if (unidadesNum > 110) {
      setErrorProducto('El stock físico en unidades no puede ser mayor a 110.');
      return;
    }
    const noFraccionableSinUnidades =
      productoEscaneado.fraccionable !== 1 &&
      (productoEscaneado.stock_unidades ?? 0) === 0;
    if (noFraccionableSinUnidades && unidadesNum !== 0) {
      setErrorProducto(
        'Este producto no es fraccionable y el stock de unidades es 0; no se pueden cargar unidades sueltas.'
      );
      return;
    }
    const unidadesFinal = noFraccionableSinUnidades ? 0 : unidadesNum;

    // Si tenemos unidades_por_caja desde el backend, podríamos usarla; por ahora asumimos 1 unidad por caja.
    const unidadesPorCaja = productoEscaneado.unidades_por_caja && !isNaN(productoEscaneado.unidades_por_caja)
      ? productoEscaneado.unidades_por_caja
      : 1;
    const totalUnidades = cajasNum * unidadesPorCaja + unidadesFinal;

    setGuardando(true);
    try {
      let res: Response;

      // Si ya existe un detalle para este producto en el control, actualizamos la línea existente (PATCH)
      if (detalleSeleccionadoId) {
        res = await fetch(`/api/inventario/${id}/detalles`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            detalle_id: detalleSeleccionadoId,
            stock_sist_cajas: productoEscaneado.stock_cajas ?? null,
            stock_sist_unidades: productoEscaneado.stock_unidades ?? null,
            stock_real_cajas: cajasNum,
            stock_real_unidades: unidadesFinal,
            stock_real: totalUnidades,
          }),
        });
      } else {
        // Si el producto todavía no existe en el control, creamos una línea nueva (POST)
        res = await fetch(`/api/inventario/${id}/detalles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producto_id_sistema: productoEscaneado.producto_id_sistema,
            codigo_barras: productoEscaneado.codigo_barras,
            descripcion: productoEscaneado.descripcion,
            presentacion: productoEscaneado.presentacion,
            laboratorio: productoEscaneado.laboratorio,
            stock_sistema: productoEscaneado.stock_sistema,
            stock_sist_cajas: productoEscaneado.stock_cajas ?? undefined,
            stock_sist_unidades: productoEscaneado.stock_unidades ?? undefined,
            stock_real_cajas: cajasNum || undefined,
            stock_real_unidades: unidadesFinal || undefined,
            stock_real: totalUnidades,
          }),
        });
      }

      const json = await res.json() as { error?: string };
      if (!res.ok) { setErrorProducto(json.error ?? 'Error al guardar'); return; }

      setProductoEscaneado(null);
      setStockRealCajas('');
      setStockRealUnidades('');
      // Si venís de una búsqueda manual, limpiamos resultados para que
      // no quede visible solo el panel de resultados.
      setResultadosBusqueda([]);
      stopCardCamera();
      recentlyConfirmedBarcodesRef.current.set(productoEscaneado.codigo_barras, Date.now());
      lastConfirmedBarcodeRef.current = { value: productoEscaneado.codigo_barras, at: Date.now() };
      mustScanDifferentBarcodeRef.current = productoEscaneado.codigo_barras;
      setDetalleSeleccionadoId(null);
      setFiltroCodigo('');
      setFiltroNombre('');

      // Si actualizamos un detalle existente en un inventario diario, lo reflejamos en memoria
      // para no romper el orden original de la lista.
      if (control?.categoria_macro && detalleSeleccionadoId) {
        setControl(prev => {
          if (!prev) return prev;
          const detallesPrev = prev.controles_inventario_detalle ?? [];
          const nuevosDetalles = detallesPrev.map(d => {
            if (d.id !== detalleSeleccionadoId) return d;
            const nuevoStockSistema = productoEscaneado.stock_sistema;
            const nuevaDiferencia = totalUnidades - nuevoStockSistema;
            return {
              ...d,
              stock_sistema: nuevoStockSistema,
              stock_sist_cajas: productoEscaneado.stock_cajas ?? null,
              stock_sist_unidades: productoEscaneado.stock_unidades ?? null,
              stock_real_cajas: cajasNum,
              stock_real_unidades: unidadesFinal,
              stock_real: totalUnidades,
              diferencia: nuevaDiferencia,
            };
          });
          return {
            ...prev,
            controles_inventario_detalle: nuevosDetalles,
          };
        });
      } else {
        // Para otros inventarios, recargamos desde el backend.
        await cargarControl();
      }
    } catch {
      setErrorProducto('Error al guardar la línea');
    } finally {
      setGuardando(false);
    }
  }

  async function handleMarcarVerificado() {
    if (!productoEscaneado || !detalleSeleccionadoId) return;
    const detalleActual =
      (control?.controles_inventario_detalle ?? []).find((d) => d.id === detalleSeleccionadoId) ?? null;
    const nextVerificado = detalleActual?.verificado === 1 ? 0 : 1;

    const cajasNum =
      stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
    const unidadesNum =
      stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);

    if (isNaN(cajasNum) || cajasNum < 0 || isNaN(unidadesNum) || unidadesNum < 0) {
      setErrorProducto('Ingresá cantidades válidas antes de marcar como verificado.');
      return;
    }

    const noFraccionableSinUnidades =
      productoEscaneado.fraccionable !== 1 &&
      (productoEscaneado.stock_unidades ?? 0) === 0;
    if (noFraccionableSinUnidades && unidadesNum !== 0) {
      setErrorProducto(
        'Este producto no es fraccionable y el stock de unidades es 0; no se pueden cargar unidades sueltas.'
      );
      return;
    }
    const unidadesFinal = noFraccionableSinUnidades ? 0 : unidadesNum;

    const unidadesPorCaja = productoEscaneado.unidades_por_caja && !isNaN(productoEscaneado.unidades_por_caja)
      ? productoEscaneado.unidades_por_caja
      : 1;
    const totalUnidades = cajasNum * unidadesPorCaja + unidadesFinal;

    setGuardando(true);
    try {
      const res = await fetch(`/api/inventario/${id}/detalles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detalle_id: detalleSeleccionadoId,
          stock_sist_cajas: productoEscaneado.stock_cajas ?? null,
          stock_sist_unidades: productoEscaneado.stock_unidades ?? null,
          stock_real_cajas: cajasNum,
          stock_real_unidades: unidadesFinal,
          stock_real: totalUnidades,
          verificado: nextVerificado,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setErrorProducto(json.error ?? 'Error al actualizar verificado');
        return;
      }

      setControl(prev => {
        if (!prev) return prev;
        const detallesPrev = prev.controles_inventario_detalle ?? [];
        const nuevosDetalles = detallesPrev.map(d => {
          if (d.id !== detalleSeleccionadoId) return d;
          const nuevoStockSistema = productoEscaneado.stock_sistema;
          const nuevaDiferencia = totalUnidades - nuevoStockSistema;
          return {
            ...d,
            stock_sistema: nuevoStockSistema,
            stock_sist_cajas: productoEscaneado.stock_cajas ?? null,
            stock_sist_unidades: productoEscaneado.stock_unidades ?? null,
            stock_real_cajas: cajasNum,
            stock_real_unidades: unidadesFinal,
            stock_real: totalUnidades,
            diferencia: nuevaDiferencia,
            verificado: nextVerificado,
          };
        });
        return {
          ...prev,
          controles_inventario_detalle: nuevosDetalles,
        };
      });
    } catch {
      setErrorProducto('Error al actualizar verificado');
    } finally {
      setGuardando(false);
    }
  }

  async function handleEliminarLinea(detalleId: string) {
    if (!confirm('¿Eliminar esta línea?')) return;
    await fetch(`/api/inventario/${id}/detalles?detalle_id=${detalleId}`, { method: 'DELETE' });
    await cargarControl();
  }

  if (loading) return <PageSpinner />;
  if (error || !control) return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-red-700">{error || 'Control no encontrado'}</p>
      <Link href="/dashboard"><Button variant="outline" className="mt-4">Volver al dashboard</Button></Link>
    </div>
  );

  const enProgreso = control.estado === 'en_progreso';
  const tipoControl = inferirTipoControlInventario({
    origen: control.origen,
    tipo: control.tipo ?? null,
    categoria_macro: control.categoria_macro ?? null,
    descripcion: control.descripcion ?? null,
  });
  // Nombre completo del operador que realizó el control (desde join con operadores)
  const operadorNombreCompleto =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((control as any).operadores?.nombrecompleto as string | undefined) ??
    // Fallback por si en algún momento se mapea a otra propiedad
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((control as any).operadores?.nombreCompleto as string | undefined) ??
    '';
  const esControlGuiado = control.categoria_macro != null && tipoControl === 'diario';
  const detalles = [...(control.controles_inventario_detalle ?? [])].sort((a, b) => {
    if (esControlGuiado) {
      const aInventariado = a.stock_real_cajas != null || a.stock_real_unidades != null;
      const bInventariado = b.stock_real_cajas != null || b.stock_real_unidades != null;
      // En inventario diario guiado: primero los pendientes por recontar.
      if (aInventariado !== bInventariado) {
        return aInventariado ? 1 : -1;
      }
    }
    return new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime();
  });
  let detallesFiltrados = detalles;
  if (control.categoria_macro && filtroCodigo) {
    detallesFiltrados = detallesFiltrados.filter((d) => d.codigo_barras === filtroCodigo);
  }
  if (filtroNombre.trim()) {
    const q = filtroNombre.toLowerCase();
    detallesFiltrados = detallesFiltrados.filter((d) => {
      const nombreCompleto = `${d.descripcion ?? ''} ${d.presentacion ?? ''}`.toLowerCase();
      return nombreCompleto.includes(q);
    });
  }

  // Resumen final de sobrantes / faltantes basado en cajas y unidades
  let totalSobrantes = 0;
  let totalFaltantes = 0;
  let totalSinDiferencia = 0;
  const totalInventariados = detalles.filter(
    (d) => d.stock_real_cajas != null || d.stock_real_unidades != null
  ).length;
  for (const d of detalles) {
    const sistC = d.stock_sist_cajas ?? 0;
    const sistU = d.stock_sist_unidades ?? 0;
    const realC = d.stock_real_cajas ?? 0;
    const realU = d.stock_real_unidades ?? 0;
    const diffC = realC - sistC;
    const diffU = realU - sistU;
    if (diffC === 0 && diffU === 0) {
      totalSinDiferencia += 1;
    } else if (diffC > 0 || diffU > 0) {
      totalSobrantes += 1;
    } else {
      totalFaltantes += 1;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">Control de inventario</h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
              {control.categoria_macro && (
                <span className="text-sm text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
                  Categoría: {control.categoria_macro}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin && ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
            {operadorNombreCompleto && (
              <p className="text-sm text-gray-500 mt-0.5">
                Operador: {operadorNombreCompleto}
              </p>
            )}
            {control.descripcion && (
              <p className="text-sm text-gray-500 mt-0.5">Descripción: {control.descripcion}</p>
            )}
          </div>
        </div>

        {enProgreso && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => router.push(`/inventario/${id}/diferencias`)}
            className="shrink-0 gap-1"
          >
            <CheckCircle2 className="h-4 w-4" />
            Revisar diferencias
          </Button>
        )}
      </div>

      {/* Scanner (solo si está en progreso) */}
      {enProgreso && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Buscar producto</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BarcodeScanner
              onScan={handleScan}
              // Si hay card abierta, bloqueamos buscador y cámara principal.
              // El lector USB sigue activo por captura global para sumar cajas.
              disabled={
                buscandoProducto ||
                guardando ||
                !!productoEscaneado
              }
              placeholder="Escanear código o escribir nombre de producto..."
              // En inventarios diarios guiados mantenemos el foco en el escáner;
              // en ocasionales/auditoría dejamos que el usuario use el buscador manual.
              autoFocusInput={esControlGuiado && !productoEscaneado}
              // Si hay card abierta y no se está editando manualmente, capturamos globalmente
              // para que el lector USB funcione aunque no esté enfocado el input del scanner.
              captureGlobally={!!productoEscaneado && !editandoCard}
            />

            {/* Resultados de búsqueda manual en medicamentos (para ocasional / auditoría) */}
            {!esControlGuiado && resultadosBusqueda.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 space-y-2">
                <p className="font-semibold">Resultados:</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {resultadosBusqueda.map((r) => (
                    <li
                      key={`${r.producto_id_sistema}-${r.codigo_barras ?? 'sin-bc'}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {r.descripcion}
                        </p>
                        <p className="truncate text-base text-gray-900">
                          {r.presentacion} · {r.laboratorio}
                        </p>
                        <p className="font-mono text-base text-gray-900">
                          {r.codigo_barras ?? 'Sin código de barras'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        title="Agregar al inventario"
                        onClick={() => {
                          void handleAgregarDesdeBusqueda({
                            producto_id_sistema: r.producto_id_sistema,
                            codigo_barras: r.codigo_barras,
                          });
                        }}
                      >
                        Agregar
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {esControlGuiado && filtroNombre.trim() && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <div className="flex items-center justify-between gap-2">
                  <p>Mostrando resultados para: <span className="font-semibold">{filtroNombre}</span></p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFiltroNombre('');
                      setErrorProducto('');
                      setDetalleSeleccionadoId(null);
                    }}
                  >
                    Volver al listado
                  </Button>
                </div>
              </div>
            )}

            {buscandoProducto && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                Buscando producto...
              </div>
            )}

            {errorProducto && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {errorProducto}
              </div>
            )}

            {/* Ficha del producto escaneado */}
            {productoEscaneado && (
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-lg">{productoEscaneado.descripcion}</p>
                      {productoEscaneado.refrigerado && (
                        <div className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-cyan-100 text-cyan-700 border border-cyan-200" title="Producto refrigerado">
                          <Snowflake className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                    <p className="text-base text-gray-900">{productoEscaneado.presentacion} . {productoEscaneado.laboratorio}</p>
                    <p className="mt-2 font-mono text-base text-gray-800">
                      {productoEscaneado.codigo_barras}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {(() => {
                      if (!productoEscaneado || !detalleSeleccionadoId) return null;
                      const hayCargaFisica = stockRealCajas.trim() !== '' || stockRealUnidades.trim() !== '';
                      if (!hayCargaFisica) return null;
                      const sistCajas = productoEscaneado.stock_cajas ?? 0;
                      const sistUnidades = productoEscaneado.stock_unidades ?? 0;
                      const cajasNum = stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
                      const unidadesNum = stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);
                      const diffCajas = (isNaN(cajasNum) ? 0 : cajasNum) - sistCajas;
                      const diffUnidades = (isNaN(unidadesNum) ? 0 : unidadesNum) - sistUnidades;
                      const tieneDiferencia = diffCajas !== 0 || diffUnidades !== 0;
                      if (!tieneDiferencia) return null;

                      const detalleActual =
                        (control?.controles_inventario_detalle ?? []).find((d) => d.id === detalleSeleccionadoId) ?? null;
                      const yaVerificado = detalleActual?.verificado === 1;

                      return (
                        <Button
                          variant={yaVerificado ? 'secondary' : 'outline'}
                          size="sm"
                          loading={guardando}
                          onClick={handleMarcarVerificado}
                          className="h-10 w-10 p-0"
                          title={yaVerificado ? 'Verificado' : 'Marcar como verificado'}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      );
                    })()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Columna izquierda: stock sistema (cajas/unidades) */}
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Stock sistema</p>
                    <div className="space-y-1">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-400">Cajas</p>
                        <p className="text-2xl font-extrabold text-gray-900 leading-tight">
                          {productoEscaneado.stock_cajas ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-400">Unidades</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight">
                          {productoEscaneado.stock_unidades ?? 0}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Columna derecha: stock real (inputs cajas/unidades) */}
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 space-y-2">
                    <Input
                      ref={inputCajasRef}
                      label="Stock real (cajas)"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={stockRealCajas}
                      onChange={e => handleChangeStockRealCajas(e.target.value)}
                      onFocus={() => handleCardInputFocus('cajas')}
                      onBlur={handleCardInputBlur}
                      onKeyDown={e => handleCardInputKeyDown('cajas', e)}
                      placeholder="0"
                      className="text-xl font-bold"
                    />
                    {(() => {
                      const noPermitirUnidades =
                        productoEscaneado.fraccionable !== 1 &&
                        (productoEscaneado.stock_unidades ?? 0) === 0;
                      return (
                        <Input
                          ref={inputUnidadesRef}
                          label="Stock real (unidades)"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={noPermitirUnidades ? '0' : stockRealUnidades}
                          onChange={e => !noPermitirUnidades && handleChangeStockRealUnidades(e.target.value)}
                          onFocus={() => handleCardInputFocus('unidades')}
                          onBlur={handleCardInputBlur}
                          onKeyDown={e => handleCardInputKeyDown('unidades', e)}
                          placeholder="0"
                          className="text-xl font-bold"
                          disabled={noPermitirUnidades}
                          title={noPermitirUnidades ? 'Producto no fraccionable sin unidades en sistema' : undefined}
                        />
                      );
                    })()}
                  </div>
                </div>

                {productoEscaneado && (stockRealCajas !== '' || stockRealUnidades !== '') && (
                  <div
                    className={`mb-4 rounded-lg px-3 py-2 text-center ${
                      (() => {
                        const sistCajas = productoEscaneado.stock_cajas ?? 0;
                        const sistUnidades = productoEscaneado.stock_unidades ?? 0;
                        const cajasNum =
                          stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
                        const unidadesNum =
                          stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);
                        const diffCajas = cajasNum - sistCajas;
                        const diffUnidades = unidadesNum - sistUnidades;
                        if (diffCajas === 0 && diffUnidades === 0)
                          return 'bg-green-50 text-green-700';
                        if (diffCajas > 0 || diffUnidades > 0)
                          return 'bg-blue-50 text-blue-700';
                        return 'bg-red-50 text-red-700';
                      })()
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {(() => {
                        const sistCajas = productoEscaneado.stock_cajas ?? 0;
                        const sistUnidades = productoEscaneado.stock_unidades ?? 0;
                        const cajasNum =
                          stockRealCajas.trim() === '' ? 0 : parseFloat(stockRealCajas);
                        const unidadesNum =
                          stockRealUnidades.trim() === '' ? 0 : parseFloat(stockRealUnidades);
                        const diffCajas = cajasNum - sistCajas;
                        const diffUnidades = unidadesNum - sistUnidades;
                        const signC = diffCajas > 0 ? '+' : diffCajas < 0 ? '' : '';
                        const signU = diffUnidades > 0 ? '+' : diffUnidades < 0 ? '' : '';
                        return `Dif. cajas: ${signC}${diffCajas.toFixed(
                          0
                        )} · Dif. unidades: ${signU}${diffUnidades.toFixed(0)}`;
                      })()}
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => {
                      scanAbortRef.current?.abort();
                      scanRequestIdRef.current += 1;
                      setProductoEscaneado(null);
                      setStockRealCajas('');
                      setStockRealUnidades('');
                      stopCardCamera();
                      setCardCameraError('');
                      setErrorProducto('');
                      setDetalleSeleccionadoId(null);
          setFiltroCodigo('');
          setFiltroNombre('');
                    }}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="md"
                    loading={guardando}
                    onClick={handleGuardarLinea}
                    disabled={stockRealCajas === '' && stockRealUnidades === ''}
                    className="flex-1"
                  >
                    Confirmar
                  </Button>
                </div>

                <div className="mt-2 flex flex-col gap-2">
                  <Button
                    type="button"
                    variant={cardCameraActive ? 'danger' : 'outline'}
                    size="sm"
                    onClick={() => {
                      if (cardCameraActive) {
                        stopCardCamera();
                      } else {
                        void startCardCamera();
                      }
                    }}
                  >
                    {cardCameraActive ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                    {cardCameraActive ? 'Detener cámara (sumar cajas)' : 'Usar cámara para sumar cajas'}
                  </Button>
                  {cardCameraActive && (
                    <div className="overflow-hidden rounded-xl border-2 border-blue-300 bg-black">
                      <video
                        ref={cardCameraVideoRef}
                        className="w-full max-h-56 object-cover"
                        autoPlay
                        muted
                        playsInline
                      />
                      <p className="px-3 py-2 text-center text-xs text-white/70">
                        Escaneá el código del producto de esta card para sumar +1 caja
                      </p>
                    </div>
                  )}
                  {cardCameraError && (
                    <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                      {cardCameraError}
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabla de productos registrados */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Productos registrados</h2>
            <Badge variant="info">
              {totalInventariados}/{detalles.length} ítem
              {detalles.length !== 1 ? 's' : ''} inventariado
              {detalles.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detalles.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">
              No hay productos cargados aún. Empezá escaneando.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Producto</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Sist.</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Real</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Dif.</th>
                    {enProgreso && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detallesFiltrados.map(det => {
                    const dif = det.diferencia;
                    const sistCajas = det.stock_sist_cajas ?? 0;
                    const sistUnidades = det.stock_sist_unidades ?? 0;
                    const realCajas = det.stock_real_cajas ?? 0;
                    const realUnidades = det.stock_real_unidades ?? 0;
                    const difCajas = realCajas - sistCajas;
                    const difUnidades = realUnidades - sistUnidades;
                    const isSelected = detalleSeleccionadoId === det.id;
                    // Consideramos inventariado solo si se cargó explícitamente algún stock real.
                    const yaInventariado =
                      det.stock_real_cajas != null || det.stock_real_unidades != null;
                    const conDiferencia = difCajas !== 0 || difUnidades !== 0;
                    return (
                      <tr
                        key={det.id}
                        className={`hover:bg-gray-50 cursor-pointer ${
                          !yaInventariado
                            ? ''
                            : conDiferencia
                              ? 'bg-red-50'
                              : 'bg-green-50'
                        } ${isSelected ? 'ring-2 ring-blue-300' : ''}`}
                        onClick={async () => {
                          setErrorProducto('');
                          const cargado = await cargarProductoParaDetalle(det);
                          if (cargado) {
                            setDetalleSeleccionadoId(det.id);
                            if (control.categoria_macro) {
                              setFiltroCodigo(det.codigo_barras);
                            }
                          } else {
                            setDetalleSeleccionadoId(null);
                            setFiltroCodigo('');
                          }
                        }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{det.descripcion}</p>
                          <p className="text-base text-gray-900">
                            {det.presentacion} · {det.laboratorio}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-700">
                            {det.codigo_barras}
                          </p>
                          {refrigeradoByBarcode[(det.codigo_barras ?? '').trim()] && (
                            <div className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-cyan-100 text-cyan-700 border border-cyan-200" title="Producto refrigerado">
                              <Snowflake className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{det.stock_sist_cajas == null ? '-' : sistCajas}</span>
                            <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                            <span>{det.stock_sist_unidades == null ? '-' : sistUnidades}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] uppercase tracking-wide text-gray-400">Cajas</span>
                            <span>{det.stock_real_cajas == null ? '-' : realCajas}</span>
                            <span className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">Unidades</span>
                            <span>{det.stock_real_unidades == null ? '-' : realUnidades}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${
                              difCajas === 0 ? 'text-gray-500'
                              : difCajas > 0 ? 'text-blue-600'
                              : 'text-red-600'
                            }`}>
                              {difCajas > 0 ? <TrendingUp className="h-3 w-3" /> : difCajas < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {difCajas > 0 ? '+' : ''}{difCajas}
                            </span>
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${
                              difUnidades === 0 ? 'text-gray-500'
                              : difUnidades > 0 ? 'text-blue-600'
                              : 'text-red-600'
                            }`}>
                              {difUnidades > 0 ? <TrendingUp className="h-3 w-3" /> : difUnidades < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {difUnidades > 0 ? '+' : ''}{difUnidades}
                            </span>
                          </div>
                        </td>
                        {enProgreso && (
                          <td className="px-4 py-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleEliminarLinea(det.id);
                              }}
                              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {detalles.length > 0 && (
          <CardFooter>
            <div className="flex gap-4 text-sm text-gray-500">
              <span className="text-blue-600 font-medium">
                +{totalSobrantes} sobrantes
              </span>
              <span className="text-red-600 font-medium">
                {totalFaltantes} faltantes
              </span>
              <span className="text-gray-400">
                {totalSinDiferencia} sin diferencia
              </span>
            </div>
          </CardFooter>
        )}
      </Card>

    </div>
  );
}
