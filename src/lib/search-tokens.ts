/** Logique pure de la recherche multi-termes (normalisation + couverture des tokens). */
import { normalizeName } from "./winmotor/mapping";

/** Découpe la saisie en tokens normalisés (espaces, tirets), sans accents ni casse ; ≥ 2 caractères. */
export function searchTokens(raw: string, max = 5): string[] {
  const out: string[] = [];
  for (const part of (raw || "").split(/[\s\-_/,;]+/)) {
    const t = normalizeName(part);
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}

/** Texte normalisé d'une entité (chaque champ normalisé séparément). */
export function entityText(values: (string | number | null | undefined)[]): string {
  return values
    .filter((v) => v !== null && v !== undefined && String(v) !== "")
    .map((v) => normalizeName(String(v)))
    .join(" ");
}

/** Chaque token doit être présent dans au moins un des textes (client, véhicules liés, OR liés…). */
export function coversAll(tokens: string[], texts: string[]): boolean {
  return tokens.length > 0 && tokens.every((t) => texts.some((x) => x.includes(t)));
}
