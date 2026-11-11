/**
 * Réconciliation d'AFFICHAGE (diagnostic manager) entre l'inventaire brut des montants (section E)
 * et les résultats groupés validés (section F). Ne modifie aucune donnée : indique seulement quels
 * candidats bruts correspondent strictement (désignation ET montant) à un résultat accepté.
 */
type Part = { designations: { value: string }[]; prices: { amount: number }[] };
type Res = { designation: string; amount: number };
type Cand = { label: string; amount: number };

const key = (label: string, amount: number) => `${label.replace(/\s+/g, " ").trim().toUpperCase()}|${amount.toFixed(2)}`;

export function reconcileCandidates(status: string, parts: Part[] | undefined | null, results: Res[] | undefined | null, candidates: Cand[]) {
  const none = { covered: candidates.map(() => false), allCovered: false };
  if (status !== "ok" || !parts?.length || !results?.length || parts.length !== results.length || !candidates.length) return none;
  const resKeys = results.map((r) => key(r.designation, r.amount));
  const partKeys = new Set(parts.map((p) => key(p.designations[0]?.value ?? "", p.prices[0]?.amount ?? NaN)));
  if (resKeys.some((k) => !partKeys.has(k))) return none;
  const ok = new Set(resKeys);
  const covered = candidates.map((c) => ok.has(key(c.label, c.amount)));
  return { covered, allCovered: covered.every(Boolean) };
}
