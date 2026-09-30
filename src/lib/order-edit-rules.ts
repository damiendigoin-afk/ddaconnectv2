/** Modification manuelle d'une commande existante — règles pures (miroir de la RPC update_part_order). */
import type { OrderLineInput } from "@/lib/parts";

export type EditableLine = OrderLineInput & { id?: string | null; repair_order_id?: string | null; requested_or_number?: string | null };
export type ExistingLine = EditableLine & { id: string; qty_received: number; status?: string; invoiced?: boolean };

/** Une ligne est engagée dès qu'une pièce est reçue ou qu'une facture y est rapprochée. */
export const isEngaged = (l: { qty_received?: number | null; invoiced?: boolean }) => Number(l.qty_received ?? 0) > 0 || !!l.invoiced;

/** Champs figés d'une ligne engagée : type et référence (stock/facture liés). */
export function lockedFields(l: ExistingLine): ("line_kind" | "physical_reference")[] {
  return isEngaged(l) ? ["line_kind", "physical_reference"] : [];
}

const norm = (s: string | null | undefined) => (s ?? "").trim();

/** Contrôle avant envoi : erreurs bloquantes (même règles que le serveur) + alertes explicatives. */
export function checkOrderEdit(before: ExistingLine[], after: EditableLine[], ctx: { hasReceipts: boolean; orChanged: boolean; destinationChanged: boolean; supplierChanged: boolean; invoiceLinked: boolean }) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(before.map((l) => [l.id, l]));
  const kept = new Set<string>();
  for (const a of after) {
    if (a.qty_ordered != null && a.qty_ordered < 0) errors.push("Quantité négative interdite");
    if (!a.id) continue;
    const b = byId.get(a.id);
    if (!b) { errors.push("Ligne étrangère à cette commande"); continue; }
    kept.add(a.id);
    if (!isEngaged(b)) continue;
    const label = b.physical_reference || b.designation || "?";
    if (norm(a.physical_reference) !== norm(b.physical_reference) || a.line_kind !== b.line_kind) errors.push(`Ligne ${label} déjà reçue/facturée : référence et type conservés.`);
    if (a.qty_ordered != null && a.qty_ordered < b.qty_received) errors.push(`Ligne ${label} : quantité inférieure au déjà reçu (${b.qty_received}).`);
  }
  for (const b of before) if (!kept.has(b.id) && isEngaged(b)) errors.push(`Ligne ${b.physical_reference || b.designation || "?"} déjà reçue : suppression impossible.`);
  if (ctx.hasReceipts && ctx.orChanged) warnings.push("Pièces déjà reçues : leurs affectations restent sur l'OR d'origine.");
  if (ctx.hasReceipts && ctx.destinationChanged) warnings.push("Destination : appliquée aux prochaines réceptions uniquement.");
  if (ctx.invoiceLinked && ctx.supplierChanged) warnings.push("Une facture est déjà rapprochée : elle reste liée à son document d'origine.");
  return { errors, warnings };
}

/** Charge utile envoyée à la RPC : mêmes identifiants de lignes, lignes vides nouvelles ignorées. */
export function editPayloadLines(after: EditableLine[]) {
  return after
    .filter((l) => l.id || norm(l.physical_reference) || norm(l.designation))
    .map((l) => ({
      id: l.id ?? null,
      line_kind: l.line_kind,
      physical_reference: norm(l.physical_reference),
      designation: norm(l.designation),
      qty_ordered: l.qty_ordered,
      expected_unit_cost_ht: l.expected_unit_cost_ht,
      repair_order_id: l.repair_order_id ?? null,
      requested_or_number: norm(l.requested_or_number) || null,
    }));
}
