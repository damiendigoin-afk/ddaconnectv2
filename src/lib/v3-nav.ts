/** Navigation V3 : sections Pièces & achats encore en construction (phase B). */
export const PIECES_SECTIONS_PENDING = {
  commandes: { label: "Commandes", hint: "Commandes fournisseurs rattachées aux OR WinMotor" },
  reception: { label: "Réception pièces", hint: "Contrôle des livraisons et rapprochement BL" },
  stock: { label: "Stock / inventaire", hint: "Emplacements, quantités et inventaires tournants" },
  references: { label: "Références à compléter", hint: "Pièces pointées sans référence exploitable" },
  regulariser: { label: "À régulariser", hint: "Écarts entre pièces pointées, commandées et facturées" },
} as const;

export type PendingSection = keyof typeof PIECES_SECTIONS_PENDING;

export function isPendingSection(v: string): v is PendingSection {
  return Object.prototype.hasOwnProperty.call(PIECES_SECTIONS_PENDING, v);
}
