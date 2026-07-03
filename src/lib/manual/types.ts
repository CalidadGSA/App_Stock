export type ManualBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'steps'; steps: { title: string; text: string }[] }
  | {
      type: 'callout';
      title: string;
      text: string;
      variant?: 'info' | 'warning' | 'tip';
    }
  | { type: 'faq'; items: { q: string; a: string }[] };

export interface ManualPageDef {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  blocks: ManualBlock[];
  /** Portada especial (sin chrome de página). */
  isCover?: boolean;
}

export interface ManualCoverMeta {
  rolLabel: string;
  edition: string;
  modules: string[];
}
