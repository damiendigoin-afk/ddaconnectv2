/** Référentiel global Fournisseurs (transverse à tous les modules DDA Connect). */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];
export type SupplierContact = Database["public"]["Tables"]["supplier_contacts"]["Row"];

/** Services / types de contact fournisseur. */
export const CONTACT_SERVICES = [
  { key: "magasin_pr", label: "Magasin Pièces de Rechange" },
  { key: "retour_pr", label: "Retour PR" },
  { key: "commercial", label: "Commercial" },
  { key: "comptabilite", label: "Comptabilité" },
  { key: "atelier", label: "Atelier" },
  { key: "sav", label: "SAV" },
  { key: "direction", label: "Direction" },
  { key: "autre", label: "Autre" },
] as const;

export function serviceLabel(key: string | null): string {
  return CONTACT_SERVICES.find((s) => s.key === key)?.label ?? "Autre";
}

/** Catégories indicatives (filtres) — un seul référentiel, pas de listes séparées. */
export const SUPPLIER_CATEGORIES = [
  { key: "concession", label: "Concession / réseau constructeur" },
  { key: "pieces", label: "Distributeur de pièces" },
  { key: "peinture", label: "Peinture" },
  { key: "consommables", label: "Consommables" },
  { key: "outillage", label: "Outillage" },
  { key: "prestataire", label: "Prestataire / service" },
  { key: "autre", label: "Autre" },
] as const;

export function contactName(c: Pick<SupplierContact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact";
}

export async function listSuppliers() {
  const { data } = await supabase.from("suppliers").select("*").order("name");
  return (data ?? []) as Supplier[];
}

export async function getSupplier(id: string) {
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Supplier | null;
}

export async function listContacts(supplierId: string) {
  const { data } = await supabase
    .from("supplier_contacts")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("is_primary", { ascending: false })
    .order("last_name");
  return (data ?? []) as SupplierContact[];
}

/** Contacts Magasin PR / Retour PR d'un fournisseur (les plus pertinents en premier). */
export function partsContacts(contacts: SupplierContact[]): SupplierContact[] {
  return contacts
    .filter((c) => c.active && (c.service === "retour_pr" || c.service === "magasin_pr") && c.email)
    .sort((a, b) => {
      if (a.service !== b.service) return a.service === "retour_pr" ? -1 : 1;
      return Number(b.is_primary) - Number(a.is_primary);
    });
}

/**
 * Adresse à utiliser pour tout e-mail lié aux pièces de rechange
 * (retour, avoir, litige…) : contact Retour PR / Magasin PR en priorité,
 * puis adresse retours du fournisseur, puis adresse générale.
 */
export async function partsEmailFor(supplierId: string | null | undefined, supplier?: Supplier | null): Promise<string> {
  if (!supplierId) return supplier?.returns_email || supplier?.email || "";
  const contacts = await listContacts(supplierId);
  const best = partsContacts(contacts)[0];
  if (best?.email) return best.email;
  const s = supplier ?? (await getSupplier(supplierId));
  return s?.returns_email || s?.email || "";
}
