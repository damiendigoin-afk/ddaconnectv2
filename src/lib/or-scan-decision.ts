/**
 * Décision après OCR/saisie d'un OR WinMotor depuis l'Atelier (pure, testable).
 * Le numéro d'OR vient toujours de WinMotor : DDA n'en génère jamais. Si aucune
 * fiche n'existe pour site + n° d'OR, on crée une fiche dossier DDA locale qui
 * conserve ce numéro (`ensure_winmotor_dossier`), puis on l'ouvre.
 */
export type OrScanDecision =
  | { kind: "ensure"; or_number: string; plate: string | null }
  | { kind: "plate"; plate: string; note: string | null }
  | { kind: "note"; note: string };

export function isWinmotorOrNumber(v: string | null | undefined): boolean {
  return /^\d{3,8}$/.test((v ?? "").trim());
}

export function decideOrScan(input: { or_number: string | null; plate: string | null }): OrScanDecision {
  const num = input.or_number?.trim() ?? "";
  if (isWinmotorOrNumber(num)) return { kind: "ensure", or_number: num, plate: input.plate };
  if (input.plate) return { kind: "plate", plate: input.plate, note: null };
  return { kind: "note", note: "Aucun OR ni immatriculation lisible. Saisissez le numéro manuellement." };
}

export type EnsureResult = { id?: string; created?: boolean; adopted?: boolean; needs_plate?: boolean; error?: string };

/** Traduit le retour de ensure_winmotor_dossier en action d'écran. */
export function interpretEnsure(orNumber: string, r: EnsureResult | null):
  | { kind: "open"; orId: string; created: boolean }
  | { kind: "needs_plate"; note: string }
  | { kind: "error"; note: string } {
  if (r?.id) return { kind: "open", orId: r.id, created: !!r.created };
  if (r?.needs_plate)
    return { kind: "needs_plate", note: `OR ${orNumber} : saisissez l'immatriculation du véhicule pour créer la fiche dossier.` };
  const map: Record<string, string> = {
    site_required: "Choisissez d'abord un site actif (pas la vue Groupe).",
    invalid_or_number: "Numéro d'OR WinMotor invalide (3 à 8 chiffres).",
    invalid_plate: "Immatriculation invalide.",
  };
  return { kind: "error", note: map[r?.error ?? ""] ?? "Ouverture du dossier impossible." };
}
