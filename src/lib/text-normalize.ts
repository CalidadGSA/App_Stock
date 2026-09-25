/**
 * Normaliza texto de búsqueda a la forma Unicode NFC (caracteres acentuados
 * "precompuestos", ej. "ñ" = U+00F1) para evitar falsos negativos cuando el
 * texto ingresado por el usuario llega en forma NFD (ej. "n" + tilde combinante
 * U+0303), algo que puede ocurrir según el teclado/SO/navegador usado.
 *
 * Sin esta normalización, comparaciones byte a byte (ILIKE en SQL, o
 * String.includes en JS) pueden fallar aunque el texto se vea idéntico en
 * pantalla, típicamente con vocales acentuadas y "ñ".
 */
export function normalizarTextoBusqueda(raw: string | null | undefined): string {
  return String(raw ?? '').normalize('NFC');
}
