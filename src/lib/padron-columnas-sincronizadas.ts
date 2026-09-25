/**
 * Columnas de `padron_final` que escribe un sync automático y por eso son de **solo lectura**
 * en esta app: cualquier edición manual se pierde en la próxima corrida del sync.
 *
 * Fuente de verdad: proyecto `abastecimiento-gsa`
 *  - `lib/padron-final-plexdr-sync.ts` → `PLEXDR_PRODUCTOS_PADRON_SYNC_MAP`
 *    (MySQL `plexdr.productos` + `productoscodebars`).
 *  - `lib/padron-final-onze-proveedor-sync.ts` → `proveedormarrone`
 *    (`onze_center.medicamentos.idProveedor` → `proveedores.Razon`).
 *
 * El resto de las columnas (categoria, cat_macro, temporada, formato, sub_categoria,
 * comisiones_vc, clasificacion_por_facturacion, cronica, etc.) las carga GSA a mano o por
 * importación de Excel en abastecimiento, y siguen siendo editables.
 *
 * Si en abastecimiento-gsa se agrega una columna al sync, hay que agregarla acá.
 */

export type OrigenPadronSincronizado = 'plexdr' | 'onze_center';

/** Columna de `padron_final` (en minúscula) → sistema que la escribe. */
export const PADRON_COLUMNAS_SINCRONIZADAS: Readonly<Record<string, OrigenPadronSincronizado>> = {
  idproducto: 'plexdr',
  troquel: 'plexdr',
  costoppp: 'plexdr',
  precio: 'plexdr',
  concentracion: 'plexdr',
  codebar: 'plexdr',
  codebar2: 'plexdr',
  codebar3: 'plexdr',
  codebar4: 'plexdr',
  producto: 'plexdr',
  presentacion: 'plexdr',
  unidades: 'plexdr',
  importado: 'plexdr',
  activo: 'plexdr',
  refrigeracion: 'plexdr',
  costo: 'plexdr',
  margen: 'plexdr',
  codalfabeta: 'plexdr',
  ultimocosto: 'plexdr',
  gtin: 'plexdr',
  trazable: 'plexdr',
  fechaprecio: 'plexdr',
  vencimiento: 'plexdr',
  cantidadbulto: 'plexdr',
  tipoactualcosto: 'plexdr',
  margenpvp: 'plexdr',
  desclaboratorio: 'plexdr',
  fechamodificacion: 'plexdr',
  sector: 'plexdr',
  modulo: 'plexdr',
  fila: 'plexdr',
  posicion: 'plexdr',
  proveedormarrone: 'onze_center',
};

/** Sistema que sincroniza la columna, o null si la edita GSA. */
export function origenPadronSincronizado(
  columna: string | null | undefined
): OrigenPadronSincronizado | null {
  const key = String(columna ?? '').trim().toLowerCase();
  return PADRON_COLUMNAS_SINCRONIZADAS[key] ?? null;
}

export function esColumnaPadronSincronizada(columna: string | null | undefined): boolean {
  return origenPadronSincronizado(columna) !== null;
}

/** Texto para la UI y los mensajes de error. */
export function etiquetaOrigenPadron(origen: OrigenPadronSincronizado): string {
  return origen === 'plexdr' ? 'Plex (plexdr)' : 'Onze Center';
}

/** Mensaje único para varias columnas rechazadas. */
export function mensajeColumnasSincronizadas(columnas: string[]): string {
  const origenes = new Set(
    columnas.map((c) => origenPadronSincronizado(c)).filter((o): o is OrigenPadronSincronizado => !!o)
  );
  const detalle = Array.from(origenes).map(etiquetaOrigenPadron).join(' / ');
  return `Estos campos se sincronizan desde ${detalle} y no se editan desde la app: ${columnas.join(', ')}.`;
}
