/** Règles pures de la liste d'approvisionnement (miroir de generate_procurement_orders). */
export type ProcLineLike = { id?: string; supplier_id: string | null; generated_order_id: string | null; status: string; designation: string; quantity: number; source_price_ht?: number | null };

export const lineStatus = (l: ProcLineLike) =>
  l.status === "cancelled" ? "cancelled" : l.generated_order_id ? "ordered" : l.supplier_id ? "ready" : "to_assign";

/** Lignes prêtes non générées groupées par fournisseur ; non affectées comptées à part. */
export function generationPlan(lines: ProcLineLike[]) {
  const groups = new Map<string, ProcLineLike[]>();
  let unassigned = 0;
  let alreadyOrdered = 0;
  for (const l of lines) {
    const s = lineStatus(l);
    if (s === "ordered") alreadyOrdered += 1;
    else if (s === "to_assign") unassigned += 1;
    else if (s === "ready") groups.set(l.supplier_id!, [...(groups.get(l.supplier_id!) ?? []), l]);
  }
  return { groups, unassigned, alreadyOrdered };
}

/** Message bloquant avant génération, sinon null. L'OR est obligatoire. */
export function generationBlocker(list: { requested_or_number: string | null; status: string }, lines: ProcLineLike[]): string | null {
  if (list.status === "cancelled") return "Liste annulée.";
  if (!/\d{3,}/.test(list.requested_or_number ?? "")) return "Renseignez le n° d'OR / dossier WinMotor avant de générer les commandes.";
  if (!generationPlan(lines).groups.size) return "Aucune ligne prête : choisissez un fournisseur sur au moins une ligne.";
  return null;
}

export function confirmText(lines: ProcLineLike[], supplierName: (id: string) => string): string {
  const { groups, unassigned } = generationPlan(lines);
  const parts = [...groups].map(([id, ls]) => `${ls.length} ligne${ls.length > 1 ? "s" : ""} → ${supplierName(id)}`);
  return `Générer ${groups.size} commande${groups.size > 1 ? "s" : ""} :\n${parts.join("\n")}${unassigned ? `\n${unassigned} ligne${unassigned > 1 ? "s" : ""} encore non affectée${unassigned > 1 ? "s" : ""} (aucune commande).` : ""}`;
}

/** Ligne de commande générée : le prix source n'est JAMAIS un PA. */
export function orderLineFromProcurement(l: { reference: string | null; designation: string; quantity: number; item_type: string }) {
  return {
    line_kind: l.item_type === "fee" || l.item_type === "service" ? "fee" : "part",
    physical_reference: l.reference?.trim() || null,
    designation: l.designation,
    qty_ordered: l.quantity > 0 ? l.quantity : 1,
    expected_unit_cost_ht: null as number | null,
  };
}

export const SOURCE_TYPE_LABEL: Record<string, string> = { expertise: "Rapport d'expertise", ixellio: "Devis Ixellio / ETAI", manual: "Saisie manuelle", other: "Autre liste de pièces" };
export const ITEM_TYPE_LABEL: Record<string, string> = { part: "Pièce", consumable: "Consommable", fee: "Frais", service: "Service" };
export const LINE_STATUS_LABEL: Record<string, string> = { to_assign: "À affecter", ready: "Prête", ordered: "Commandée", cancelled: "Annulée" };
