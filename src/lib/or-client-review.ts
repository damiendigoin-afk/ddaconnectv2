/** Affichage pur de la revue client d'un OR (brouillon de capture, candidats WinMotor du même site). */
export type ClientCandidate = {
  customer_id: string;
  account_number: string | null;
  last_name: string | null;
  first_name: string | null;
  company_name: string | null;
  plates: string | null;
  account_match: boolean;
  vehicle_match: boolean;
  name_match: boolean;
};

export function candidateLabel(c: ClientCandidate): string {
  const name = [c.last_name, c.first_name].filter(Boolean).join(" ") || c.company_name || "Sans nom";
  return [name, c.account_number ? `compte ${c.account_number}` : null, c.plates].filter(Boolean).join(" — ");
}

const LABELS: [string, string][] = [
  ["first_name", "Prénom"], ["account_number", "Compte"], ["mobile", "Mobile"], ["phone", "Tél."], ["email", "E-mail"],
  ["address", "Adresse"], ["postal_code", "CP"], ["city", "Ville"],
];
export function captureSummary(d: Record<string, unknown>): string {
  return LABELS.filter(([k]) => d[k] != null && String(d[k]).trim() !== "").map(([k, l]) => `${l} : ${String(d[k]).trim()}`).join(" · ");
}
