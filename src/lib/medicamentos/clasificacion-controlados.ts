export type TipoProductoControlado = 'psicotropico' | 'estupefaciente';

/** Códigos que no son psicotrópico ni estupefaciente (p. ej. N = normal, A = no aplica). */
const IDS_NO_CONTROLADO = new Set(['', 'N', 'NO', 'A']);

/** Códigos legacy habituales para estupefacientes (además del nombre en catálogo). */
const IDS_ESTUPEFACIENTE = new Set(['E', 'EST', 'ESTUPEFACIENTE', 'ESTUPEFACIENTES']);

export function normalizarIdPsicofarmaco(id: string | null | undefined): string {
  return String(id ?? '').trim().toUpperCase();
}

export function esProductoControlado(idPsicofarmaco: string | null | undefined): boolean {
  const id = normalizarIdPsicofarmaco(idPsicofarmaco);
  return id.length > 0 && !IDS_NO_CONTROLADO.has(id);
}

export function nombreIndicaEstupefaciente(nombre: string | null | undefined): boolean {
  const t = String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return t.includes('ESTUPEFACIENTE');
}

export function clasificarProductoControlado(
  idPsicofarmaco: string | null | undefined,
  nombrePorId: Map<string, string>
): TipoProductoControlado | null {
  if (!esProductoControlado(idPsicofarmaco)) return null;

  const id = normalizarIdPsicofarmaco(idPsicofarmaco);
  const nombre =
    nombrePorId.get(String(idPsicofarmaco ?? '').trim()) ??
    nombrePorId.get(id) ??
    '';

  if (IDS_ESTUPEFACIENTE.has(id) || nombreIndicaEstupefaciente(nombre)) {
    return 'estupefaciente';
  }

  return 'psicotropico';
}

export function etiquetaTipoControlado(tipo: TipoProductoControlado): string {
  return tipo === 'estupefaciente' ? 'Estupefaciente' : 'Psicotrópico';
}
