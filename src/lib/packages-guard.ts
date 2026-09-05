/**
 * Garde-fou partagé parseur / persistance : un en-tête de tableau ou une ligne
 * de contenu ne doit JAMAIS devenir un libellé, un titre d'opération ou une
 * famille de forfait, même si le parseur se trompe.
 */
export function normLabel(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const FORBIDDEN_RE =
  /(^v[ée]?hicules? +motorisation +code +tarif$|^libelle +norme +huile +code +tarif$|ce forfait comprend|^tarifs? +(ttc|ht)\b|^tarifs? +zone\b|^page +\d+ *\/ *\d+$)/;

/** Vrai pour toute ligne d'en-tête de tableau (« … code … tarif ») ou de contenu. */
export function isForbiddenLabel(value: string | null | undefined): boolean {
  const n = normLabel(value);
  if (!n) return false;
  if (FORBIDDEN_RE.test(n)) return true;
  if (n.length <= 90 && !/\d{2,}/.test(n)) {
    const hasCode = /\bcode\b/.test(n);
    const hasPrice = /\b(tarif|tarifs|prix|montant)\b/.test(n);
    if (hasCode && hasPrice) return true;
  }
  return false;
}
