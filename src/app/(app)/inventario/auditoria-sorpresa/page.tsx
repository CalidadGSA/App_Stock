'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileUp, Upload } from 'lucide-react';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCsvProductoIds } from '@/lib/inventario/parse-csv-productos';

type AuditoriaAbierta = {
  id: string;
  referencia: string;
  sucursal_id: number;
  sucursal_nombre: string;
  fecha_inicio: string;
  total_productos: number;
};

export default function AuditoriaSorpresaPage() {
  const router = useRouter();
  const [abiertas, setAbiertas] = useState<AuditoriaAbierta[]>([]);
  const [sucursalActual, setSucursalActual] = useState<{ id: number; nombre: string } | null>(null);
  const [loadingInicial, setLoadingInicial] = useState(true);
  const [referencia, setReferencia] = useState('');
  const [archivoNombre, setArchivoNombre] = useState('');
  const [csvTexto, setCsvTexto] = useState('');
  const [parseInfo, setParseInfo] = useState<ReturnType<typeof parseCsvProductoIds> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    fetch('/api/inventario/auditoria-sorpresa')
      .then(async (res) => {
        const json = (await res.json()) as {
          data?: AuditoriaAbierta[];
          sucursal_actual?: { id: number; nombre: string } | null;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'No se pudo cargar la sucursal actual');
          setSucursalActual(null);
          setAbiertas([]);
          return;
        }
        setSucursalActual(json.sucursal_actual ?? null);
        setAbiertas(json.data ?? []);
      })
      .catch(() => setError('No se pudieron cargar los datos iniciales'))
      .finally(() => setLoadingInicial(false));
  }, []);

  const idsPreview = useMemo(() => parseInfo?.ids ?? [], [parseInfo]);

  function procesarContenidoCsv(texto: string, nombre?: string) {
    const parsed = parseCsvProductoIds(texto);
    setCsvTexto(texto);
    setParseInfo(parsed);
    if (nombre) setArchivoNombre(nombre);
    setAviso('');
    setError('');
  }

  async function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const texto = await file.text();
    procesarContenidoCsv(texto, file.name);
  }

  async function handleCrear() {
    setError('');
    setAviso('');
    if (!sucursalActual) {
      setError('Seleccioná una sucursal antes de crear una auditoría integral.');
      return;
    }
    if (!referencia.trim()) {
      setError('La referencia del control es obligatoria.');
      return;
    }
    if (idsPreview.length === 0) {
      setError('Importá un CSV con al menos un ID de producto (codplex).');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/inventario/auditoria-sorpresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referencia: referencia.trim(),
          producto_ids: idsPreview,
        }),
      });

      const json = (await res.json()) as {
        data?: { id: string };
        error?: string;
        resumen?: { cargados: number; no_encontrados: string[] };
      };

      if (!res.ok) {
        setError(json.error ?? 'Error al crear auditoría integral');
        return;
      }

      const noEnc = json.resumen?.no_encontrados ?? [];
      if (noEnc.length > 0) {
        setAviso(
          `Se cargaron ${json.resumen?.cargados ?? 0} productos. Omitidos: ${noEnc.slice(0, 15).join(', ')}${
            noEnc.length > 15 ? ` y ${noEnc.length - 15} más` : ''
          }.`
        );
      }

      const id = json.data?.id;
      if (id) router.replace(`/inventario/${id}`);
    } catch {
      setError('Error al crear auditoría integral');
    } finally {
      setLoading(false);
    }
  }

  if (loadingInicial) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Auditoría integral</h1>
        </div>
      </div>

      {abiertas.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <h2 className="text-sm font-semibold text-amber-950">En progreso ({abiertas.length})</h2>
          <p className="mt-1 text-xs text-amber-900">Auditorías abiertas en esta sucursal.</p>
          <ul className="mt-3 space-y-2">
            {abiertas.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/80 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">{a.referencia}</p>
                  <p className="text-xs text-gray-500">
                    {a.sucursal_nombre} · {a.total_productos} productos
                  </p>
                </div>
                <Link href={`/inventario/${a.id}`}>
                  <Button type="button" variant="outline" size="sm">
                    Continuar
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Nuevo control</h2>
          <p className="mt-1 text-xs text-gray-500">
            CSV con columna de IDs (codplex). Cabecera opcional: codplex, id, idproducto.
          </p>
        </div>

        <form
          className="flex flex-col gap-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCrear();
          }}
        >
          {sucursalActual ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Sucursal:</span>{' '}
              {sucursalActual.nombre}
              <span className="text-gray-500"></span>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No hay sucursal seleccionada.{' '}
              <Link href="/sucursal" className="font-medium underline">
                Elegir sucursal
              </Link>
            </div>
          )}

          <Input
            label="Referencia del control"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Ej: Integral psicos — marzo 2026"
            required
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Archivo CSV</label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 hover:border-blue-400">
              <Upload className="h-8 w-8 text-gray-400" />
              <span className="text-sm text-gray-600">
                {archivoNombre || 'Subir .csv'}
              </span>
              <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={handleArchivo} />
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">O pegar IDs</label>
            <textarea
              className="min-h-[100px] w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              placeholder="codplex&#10;12345&#10;67890"
              value={csvTexto}
              onChange={(e) => procesarContenidoCsv(e.target.value)}
            />
          </div>

          {parseInfo && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <p className="font-medium">{idsPreview.length} productos listos</p>
              {idsPreview.length > 0 && (
                <p className="mt-1 font-mono text-xs">
                  {idsPreview.slice(0, 8).join(', ')}
                  {idsPreview.length > 8 ? ` … (+${idsPreview.length - 8})` : ''}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {aviso && !error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {aviso}
            </div>
          )}

          <Button type="submit" size="lg" loading={loading} className="w-full gap-2">
            <FileUp className="h-4 w-4" />
            Crear auditoría e iniciar conteo
          </Button>
        </form>
      </div>

      {loading && (
        <div className="mt-6">
          <PageSpinner />
        </div>
      )}
    </div>
  );
}
