/** Décision après OCR OR/plaque depuis l'Atelier (pure, testable). Jamais de création d'OR. */
export type OrScanDecision =
  | { kind: "open_or"; orId: string }
  | { kind: "plate"; plate: string; note: string | null }
  | { kind: "note"; note: string };

export function decideOrScan(input: {
  or_number: string | null;
  plate: string | null;
  orIds: string[];
}): OrScanDecision {
  const { or_number, plate, orIds } = input;
  if (or_number && orIds.length === 1) return { kind: "open_or", orId: orIds[0]! };
  const orNote = or_number
    ? `OR ${or_number} lu — ${orIds.length ? "plusieurs dossiers portent ce numéro : utilisez la recherche de l'accueil." : "pas encore connu dans DDA : attendez/importez l'OR WinMotor (aucun OR créé)."}`
    : null;
  if (plate) return { kind: "plate", plate, note: orNote };
  return { kind: "note", note: orNote ?? "Aucun OR ni immatriculation lisible. Saisissez le numéro manuellement." };
}
