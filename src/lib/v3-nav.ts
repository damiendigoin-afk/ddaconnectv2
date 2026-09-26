/** Navigation V3 : sections Pièces & achats encore en construction (phase B). */
export const PIECES_SECTIONS_PENDING = {
  references: { label: "Références à compléter", hint: "Pièces pointées sans référence exploitable" },
} as const;

export type PendingSection = keyof typeof PIECES_SECTIONS_PENDING;

export function isPendingSection(v: string): v is PendingSection {
  return Object.prototype.hasOwnProperty.call(PIECES_SECTIONS_PENDING, v);
}
