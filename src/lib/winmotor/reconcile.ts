/**
 * Rapprochement WinMotor ↔ DDA (pur). Aucune affectation automatique si ambigu.
 * Une facture ne crée jamais de mouvement physique : seule une liaison sûre à une pièce affectée/utilisée
 * produit UNE sortie définitive (côté base, contrôlée et unique par lien).
 */
export type WmLine = { id: string; invoice_id: string; line_kind: string; reference_normalized: string | null; designation: string | null; qty: number | null; doc_kind?: string };
export type DdaUsage = { id: string; item_kind: string; physical_reference: string | null; qty_allocated: number; qty_used: number | null; usage_status: string; article_id: string | null };
export type Link = { invoice_line_id: string; usage_id: string | null; qty: number; status: string };

export const normRef = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function lineRemaining(line: WmLine, links: Link[]): number {
  const used = links.filter((l) => l.status === "active" && l.invoice_line_id === line.id).reduce((s, l) => s + l.qty, 0);
  return Math.max(0, Number(line.qty ?? 0) - used);
}

export function usageBase(u: DdaUsage): number {
  return u.qty_used ?? u.qty_allocated;
}

export function usageRemaining(u: DdaUsage, links: Link[]): number {
  const used = links.filter((l) => l.status === "active" && l.usage_id === u.id).reduce((s, l) => s + l.qty, 0);
  return Math.max(0, usageBase(u) - used);
}

/** Contrôle client avant appel serveur (le serveur revérifie). */
export function canLink(line: WmLine, u: DdaUsage, qty: number, links: Link[]): string | null {
  if (line.doc_kind === "preinvoice") return "Préfacture : pas de preuve de facturation définitive";
  if (!(qty > 0)) return "Quantité invalide";
  if (Number(line.qty ?? 0) <= 0) return "Ligne négative : passer par le traitement des avoirs";
  if (qty > lineRemaining(line, links)) return "Quantité supérieure au restant facturé";
  if (qty > usageRemaining(u, links)) return "Quantité supérieure au restant DDA";
  return null;
}

const isPartKind = (k: string) => k === "part" || k === "package_part";

export type Equivalences = Map<string, Set<string>>;

export function refsMatch(wm: string | null, dda: string | null, eq: Equivalences): "exact" | "equivalence" | null {
  const a = normRef(wm), b = normRef(dda);
  if (!a || !b) return null;
  if (a === b) return "exact";
  if (eq.get(a)?.has(b)) return "equivalence";
  return null;
}

export type Proposal = { lineId: string; usageId: string; qty: number; rule: "exact" | "equivalence" };

/**
 * Propositions sûres : candidat UNIQUE des deux côtés, pièce confirmée utilisée, quantités disponibles.
 * Plusieurs candidats => aucune proposition automatique.
 */
export function proposeMatches(lines: WmLine[], usages: DdaUsage[], links: Link[], eq: Equivalences): { sure: Proposal[]; ambiguous: string[] } {
  const sure: Proposal[] = [];
  const ambiguous: string[] = [];
  const candLines = lines.filter((l) => isPartKind(l.line_kind) && Number(l.qty ?? 0) > 0 && l.doc_kind !== "preinvoice" && lineRemaining(l, links) > 0);
  const candUsages = usages.filter((u) => u.usage_status === "used" || u.usage_status === "partial").filter((u) => usageRemaining(u, links) > 0);
  for (const l of candLines) {
    const matches = candUsages.map((u) => ({ u, m: refsMatch(l.reference_normalized, u.physical_reference, eq) })).filter((x) => x.m);
    if (matches.length !== 1) { if (matches.length > 1) ambiguous.push(l.id); continue; }
    const { u, m } = matches[0]!;
    const back = candLines.filter((o) => refsMatch(o.reference_normalized, u.physical_reference, eq));
    if (back.length !== 1) { ambiguous.push(l.id); continue; }
    const qty = Math.min(lineRemaining(l, links), usageRemaining(u, links));
    if (qty > 0) sure.push({ lineId: l.id, usageId: u.id, qty, rule: m! });
  }
  return { sure, ambiguous };
}

export type Anomaly = { level: "strong" | "light" | "info"; kind: "montee_non_facturee" | "facturee_non_montee" | "consommable_non_facture" | "avoir_client" | "temps_vs_mo"; ref: string | null; label: string; sourceId: string };

/** Anomalies de facturation d'un OR (toutes factures connues de l'OR cumulées). */
export function billingAnomalies(input: { lines: WmLine[]; usages: DdaUsage[]; links: Link[]; eq: Equivalences; hoursBilled: number; minutesDda: number }): Anomaly[] {
  const out: Anomaly[] = [];
  const { lines, usages, links, eq } = input;
  const billedRefs = lines.filter((l) => Number(l.qty ?? 0) > 0);
  for (const u of usages) {
    if (u.usage_status !== "used" && u.usage_status !== "partial") continue;
    if (usageRemaining(u, links) <= 0) continue;
    const covered = billedRefs.some((l) => refsMatch(l.reference_normalized, u.physical_reference, eq));
    if (covered) continue;
    if (u.item_kind === "consumable") out.push({ level: "light", kind: "consommable_non_facture", ref: u.physical_reference, label: "Consommable utilisé non facturé", sourceId: u.id });
    else out.push({ level: "strong", kind: "montee_non_facturee", ref: u.physical_reference, label: "Pièce montée non facturée", sourceId: u.id });
  }
  for (const l of lines) {
    if (!isPartKind(l.line_kind) || !l.reference_normalized) continue;
    if (Number(l.qty ?? 0) < 0) { out.push({ level: "strong", kind: "avoir_client", ref: l.reference_normalized, label: "Ligne négative / avoir client : réintégration à décider", sourceId: l.id }); continue; }
    if (lineRemaining(l, links) <= 0) continue;
    const confirmed = usages.some((u) => (u.usage_status === "used" || u.usage_status === "partial") && refsMatch(l.reference_normalized, u.physical_reference, eq));
    if (!confirmed) out.push({ level: "strong", kind: "facturee_non_montee", ref: l.reference_normalized, label: "Facturée mais non confirmée montée — retrouver la réalité", sourceId: l.id });
  }
  if (input.hoursBilled > 0 || input.minutesDda > 0) {
    out.push({ level: "info", kind: "temps_vs_mo", ref: null, label: `MO facturée ${input.hoursBilled.toFixed(2)} h · temps DDA ${(input.minutesDda / 60).toFixed(2)} h (information)`, sourceId: "time" });
  }
  return out;
}

/** Un crédit client ne réintègre jamais le stock automatiquement. */
export function creditRequiresHumanDecision(): true {
  return true;
}
