/**
 * VIN (ISO 3779) : 17 caractères, chiffres et lettres sauf I, O, Q (le zéro est autorisé).
 * Normalisation OCR : majuscules, séparateurs retirés, lettre O -> chiffre 0 (seule correction
 * sûre : O est interdite dans un VIN). I et Q ne sont jamais corrigées automatiquement.
 */
export const VIN_FORMAT = /^[A-HJ-NPR-Z0-9]{17}$/;

export type VinNorm = {
  /** Valeur brute lue (traçabilité). */
  raw: string;
  /** Valeur normalisée (O->0), même si invalide ; null si vide. */
  candidate: string | null;
  /** VIN valide (17 caractères, alphabet VIN) ; null sinon. */
  vin: string | null;
  /** true si au moins un O a été remplacé par 0. */
  corrected: boolean;
  issue: null | "empty" | "length" | "alphabet";
};

export function normalizeVin(input: unknown): VinNorm {
  const raw = String(input ?? "").trim();
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return { raw, candidate: null, vin: null, corrected: false, issue: "empty" };
  const candidate = compact.replace(/O/g, "0");
  const corrected = candidate !== compact;
  if (candidate.length !== 17) return { raw, candidate, vin: null, corrected, issue: "length" };
  if (!VIN_FORMAT.test(candidate)) return { raw, candidate, vin: null, corrected, issue: "alphabet" };
  return { raw, candidate, vin: candidate, corrected, issue: null };
}

/** Message utilisateur pour un VIN non conforme, null si conforme ou vide. */
export function vinIssueMessage(n: VinNorm): string | null {
  if (n.issue === "length") return `VIN de ${n.candidate?.length ?? 0} caractères (17 attendus).`;
  if (n.issue === "alphabet") return "VIN : lettres I et Q interdites, à vérifier sur la carte grise.";
  return null;
}
