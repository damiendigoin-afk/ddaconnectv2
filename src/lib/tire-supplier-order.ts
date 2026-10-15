/**
 * Commande pneus Districash depuis le devis — règles pures.
 *
 * Aucune API transactionnelle Districash n'est vérifiée : « Commander chez DC »
 * crée une COMMANDE INTERNE au statut `to_transmit` (à transmettre), puis ouvre la
 * fiche produit exacte pour validation manuelle sur le portail. Le statut
 * `ordered` n'est posé qu'avec un n° de commande fournisseur réel (garde SQL
 * `guard_part_order_transmit`). `transmission_mode` réserve la place d'un futur
 * connecteur documenté ; aucun envoi automatique n'existe ici.
 */
import { DISTRICASH_ACCOUNTS } from "./districash";
import type { SevenOffer } from "./tires";

export const TIRE_ORDER_STATUS_PENDING = "to_transmit" as const;

export function normPlate(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
const normRef = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, "");
const normOr = (v: string | null | undefined) => (v ?? "").trim().replace(/^0+/, "");

/** Compte Districash du site émetteur (jamais celui d'un autre site). */
export function districashAccountForSite(siteCode: string | null | undefined): string | null {
  return siteCode ? DISTRICASH_ACCOUNTS[siteCode] ?? null : null;
}

/** OR et/ou immatriculation : au moins un, au format plausible. */
export function validateTireOrderTarget(t: { orNumber: string; plate: string }): string | null {
  const or = t.orNumber.trim();
  const plate = normPlate(t.plate);
  if (!or && !plate) return "Renseignez un n° d'OR ou une immatriculation.";
  if (or && !/^\d{3,10}$/.test(or)) return "N° d'OR invalide (chiffres uniquement).";
  if (plate && (plate.length < 4 || plate.length > 12)) return "Immatriculation invalide.";
  return null;
}

/** L'offre doit être une offre Districash disponible, avec référence et prix d'achat. */
export function canOrderOffer(o: SevenOffer): boolean {
  return Boolean(o.available && o.supplier === "districash" && o.supplierRef && o.unitSourceHt != null && o.quantity > 0);
}

export type TireOrderLine = { physical_reference: string; designation: string; qty_ordered: number; expected_unit_cost_ht: number };

export function tireOrderLine(o: SevenOffer): TireOrderLine {
  const dims = [o.size, [o.loadIndex, o.speedIndex].filter(Boolean).join("")].filter(Boolean).join(" ");
  return {
    physical_reference: o.supplierRef ?? "",
    designation: [o.brand, o.model && o.model.includes(o.size ?? "§") ? o.model : [o.model, dims].filter(Boolean).join(" ")].filter(Boolean).join(" ").slice(0, 200),
    qty_ordered: o.quantity,
    expected_unit_cost_ht: Math.round((o.unitSourceHt ?? 0) * 100) / 100,
  };
}

/** Trace du devis source (interne ; jamais exposée au client). */
export function tireOrderSource(o: SevenOffer, q: { quoteId: string | null; size: string; consultedAt?: string | null }) {
  return {
    kind: "tire_quote",
    quote_id: q.quoteId,
    slot: o.slot,
    size: q.size,
    brand: o.brand,
    model: o.model,
    supplier_ref: o.supplierRef,
    product_url: o.productUrl ?? null,
    availability: o.availability,
    unit_purchase_ht: o.unitSourceHt,
    quantity: o.quantity,
    consulted_at: q.consultedAt ?? null,
  };
}

export type ExistingTireOrder = {
  id: string;
  status: string;
  supplier_id: string | null;
  requested_or_number: string | null;
  plate: string | null;
  repair_orders?: { or_number: string | null } | null;
  part_order_lines?: { physical_reference: string | null }[] | null;
};

/** Doublon = même fournisseur + même référence + même OR ou même immatriculation (annulées ignorées). */
export function findTireOrderDuplicate(
  c: { supplierId: string; ref: string; orNumber: string; plate: string },
  existing: ExistingTireOrder[],
): ExistingTireOrder | null {
  const ref = normRef(c.ref);
  const or = normOr(c.orNumber);
  const plate = normPlate(c.plate);
  return (
    existing.find((o) => {
      if (o.status === "cancelled" || o.supplier_id !== c.supplierId) return false;
      if (!(o.part_order_lines ?? []).some((l) => normRef(l.physical_reference) === ref)) return false;
      const oOr = normOr(o.repair_orders?.or_number ?? o.requested_or_number);
      return (or !== "" && oOr === or) || (plate !== "" && normPlate(o.plate) === plate);
    }) ?? null
  );
}

/**
 * Champs à saisir dans le panier Districash (onglet tiers : remplissage
 * automatique impossible entre domaines, donc copie manuelle).
 * Référence de commande = « OR: 17264 » prioritaire (sans doubler un préfixe
 * OR déjà saisi), sinon immatriculation.
 */
export function districashCartFields(t: { orNumber: string; plate: string }): { reference: string; immatriculation: string } {
  const or = t.orNumber.trim().replace(/^OR\s*[:#-]?\s*/i, "").trim();
  const plate = normPlate(t.plate);
  return { reference: or ? `OR: ${or}` : plate, immatriculation: plate };
}

/** Page panier du portail (lien direct, sans paramètre). */
export const DISTRICASH_CART_URL = "https://districashv2.inoshop.net/cart";

/** Confirmation fournisseur : n° réel obligatoire pour passer « Commandée ». */
export function validateSupplierConfirmation(ref: string): string | null {
  const r = ref.trim();
  if (!r) return "N° de commande Districash obligatoire.";
  if (r.length < 3 || r.length > 60) return "N° de commande Districash invalide.";
  return null;
}
