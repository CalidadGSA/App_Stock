'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Trash2, Package, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
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
  const [editandoCard, setEditandoCard] = useState(false);
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

  async function cargarProductoParaDetalle(detalle: ControlInventarioDetalle) {
    // Intenta traer stock actual desde /api/productos/[barcode]
    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(detalle.codigo_barras)}`);
      const json = await res.json() as { data?: ProductoLegacy; error?: string };
      if (res.ok && json.data) {
        const prod = json.data;
        setProductoEscaneado(prod);
        setStockRealCajas(
          detalle.stock_real_cajas != null ? String(detalle.stock_real_cajas) : ''
        );
        setStockRealUnidades(
          detalle.stock_real_unidades != null ? String(detalle.stock_real_unidades) : ''
        );
        return;
      }
    } catch {
      // Si falla, seguimos con los datos del detalle
    }

    // Fallback: construir a partir del detalle si el API no respondió
    setProductoEscaneado({
      producto_id_sistema: detalle.producto_id_sistema,
      codigo_barras: detalle.codigo_barras,
      codigos_secundarios: [],
      descripcion: detalle.descripcion,
      presentacion: detalle.presentacion ?? null,
      laboratorio: detalle.laboratorio ?? null,
      stock_sistema: detalle.stock_sistema,
      stock_cajas: detalle.stock_sist_cajas ?? undefined,
      stock_unidades: detalle.stock_sist_unidades ?? undefined,
      unidades_por_caja: undefined,
      fraccionable: undefined,
    });
    setStockRealCajas(
      detalle.stock_real_cajas != null ? String(detalle.stock_real_cajas) : ''
    );
    setStockRealUnidades(
      detalle.stock_real_unidades != null ? String(detalle.stock_real_unidades) : ''
    );
  }

  async function handleScan(barcode: string) {
    setErrorProducto('');

    // Si la card está abierta, cualquier barcode del mismo producto suma 1 caja.
    if (productoEscaneado) {
      if (productoAceptaBarcode(productoEscaneado, barcode)) {
        setStockRealCajas((prev) => String((parseInt(prev || '0', 10) || 0) + 1));
      } else {
        setErrorProducto('Este código no pertenece al producto seleccionado.');
      }
      return;
    }

    setProductoEscaneado(null);
    setStockRealCajas('');
    setStockRealUnidades('');
    setBuscandoProducto(true);

    // En inventarios diarios con categoría macro (FARMA/BIENESTAR/PSICOTROPICOS),
    // el escaneo solo sirve para ubicar un producto ya registrado, sin agregar líneas nuevas.
    if (control?.categoria_macro) {
      const detallesControl = control.controles_inventario_detalle ?? [];
      let detalle = detallesControl.find((d) => d.codigo_barras === barcode) ?? null;

      if (!detalle) {
        try {
          const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`);
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
        return;
      }

      setDetalleSeleccionadoId(detalle.id);
      setFiltroCodigo(detalle.codigo_barras);
      await cargarProductoParaDetalle(detalle);
      setBuscandoProducto(false);
      return;
    }

    async function fetchProducto(intento: number): Promise<void> {
      try {
        const res = await fetch(`/api/productos/${encodeURIComponent(barcode)}`);
        const json = (await res.json()) as { data?: ProductoLegacy; error?: string };

        if (!res.ok) {
          // Si es el primer intento y hay error de servidor/red, reintentar una vez.
          if (intento === 1 && (res.status >= 500 || res.status === 408)) {
            await fetchProducto(2);
            return;
          }
          setErrorProducto(json.error ?? 'Producto no encontrado');
          return;
        }
        const producto = json.data!;
        const detallesControl = control?.controles_inventario_detalle ?? [];
        const detalleExistente =
          detallesControl.find(
            (d) => d.producto_id_sistema === producto.producto_id_sistema
          ) ??
          detallesControl.find((d) => detalleCoincideConBarcode(d, barcode)) ??
          null;

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
      } catch {
        if (intento === 1) {
          await fetchProducto(2);
          return;
        }
        setErrorProducto('Error al buscar el producto');
      }
    }

    await fetchProducto(1);
    setBuscandoProducto(false);
  }

  async function handleGuardarLinea() {
    if (!productoEscaneado) return;
    // Antes de guardar, validar que el stock de sistema no haya cambiado mientras se hacía el conteo
    if (control?.categoria_macro) {
      try {
        const res = await fetch(
          `/api/productos/${encodeURIComponent(productoEscaneado.codigo_barras)}`
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
      setDetalleSeleccionadoId(null);
      setFiltroCodigo('');

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
  const detalles = [...(control.controles_inventario_detalle ?? [])].sort(
    (a, b) =>
      new Date(a.fecha_registro).getTime() -
      new Date(b.fecha_registro).getTime()
  );
  const detallesFiltrados =
    control.categoria_macro && filtroCodigo
      ? detalles.filter((d) => d.codigo_barras === filtroCodigo)
      : detalles;

  // Resumen final de sobrantes / faltantes basado en cajas y unidades
  let totalSobrantes = 0;
  let totalFaltantes = 0;
  let totalSinDiferencia = 0;
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
                <span className="text-xs text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
                  Categoría: {control.categoria_macro}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin && ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
            {control.descripcion && (
              <p className="text-xs text-gray-500 mt-0.5">Descripción: {control.descripcion}</p>
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
            <h2 className="font-semibold text-gray-900">Escanear producto</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BarcodeScanner
              onScan={handleScan}
              // En inventarios diarios guiados, el escáner sigue activo con la card abierta para sumar cajas
              disabled={
                buscandoProducto ||
                guardando
              }
              placeholder="Escanear o ingresar código de barras..."
              // En inventarios con categoria_macro no forzamos el foco permanente en el buscador
              autoFocusInput={!productoEscaneado && !control?.categoria_macro}
              captureGlobally={!!productoEscaneado && !editandoCard}
            />

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
                    <p className="font-semibold text-gray-900 text-lg">{productoEscaneado.descripcion}</p>
                    <p className="text-sm text-gray-600">{productoEscaneado.presentacion} . {productoEscaneado.laboratorio}</p>
                    <p className="mt-2 font-mono text-base text-gray-800">
                      {productoEscaneado.codigo_barras}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-200">
                    <Package className="h-5 w-5 text-blue-700" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Columna izquierda: stock sistema (cajas/unidades) */}
                  <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Stock sistema</p>
                    <div className="space-y-1">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Cajas</p>
                        <p className="text-2xl font-extrabold text-gray-900 leading-tight">
                          {productoEscaneado.stock_cajas ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Unidades</p>
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
                      setProductoEscaneado(null);
                      setStockRealCajas('');
                      setStockRealUnidades('');
                      setErrorProducto('');
                      setDetalleSeleccionadoId(null);
                      setFiltroCodigo('');
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
            <Badge variant="info">{detalles.length} ítem{detalles.length !== 1 ? 's' : ''}</Badge>
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
                    // Consideramos inventariado solo si se cargó explícitamente algún stock real
                    const yaInventariado =
                      det.stock_real_cajas != null || det.stock_real_unidades != null;
                    return (
                      <tr
                        key={det.id}
                        className={`hover:bg-gray-50 cursor-pointer ${
                          yaInventariado ? 'bg-green-50' : ''
                        } ${isSelected ? 'ring-2 ring-blue-300' : ''}`}
                        onClick={async () => {
                          setErrorProducto('');
                          setDetalleSeleccionadoId(det.id);
                          if (control.categoria_macro) {
                            setFiltroCodigo(det.codigo_barras);
                          }
                          await cargarProductoParaDetalle(det);
                        }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{det.descripcion}</p>
                          <p className="text-xs text-gray-400">
                            {det.presentacion} · {det.laboratorio}
                          </p>
                          <p className="mt-0.5 font-mono text-sm text-gray-700">
                            {det.codigo_barras}
                          </p>
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
            <div className="flex gap-4 text-xs text-gray-500">
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
