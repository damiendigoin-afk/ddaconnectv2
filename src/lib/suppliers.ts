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

const normName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Rattache un fournisseur détecté (BL/facture) à la fiche existante, ou la crée.
 * Anti-doublon : casse/espaces/accents/ponctuation ignorés, puis rapprochement
 * par mots significatifs (matchSupplier). Ambiguïté entre plusieurs fiches => null
 * (pas de création, pour ne pas dupliquer).
 */
export async function ensureSupplierByName(name: string | null | undefined): Promise<string | null> {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  const n = normName(clean);
  if (n.length < 3) return null;
  const { data } = await supabase.from("suppliers").select("id, name, active");
  const all = (data ?? []) as { id: string; name: string; active: boolean | null }[];
  const exact = all.filter((s) => normName(s.name) === n);
  if (exact.length) return (exact.find((s) => s.active !== false) ?? exact[0]!).id;
  const { matchSupplier } = await import("@/lib/parts-site");
  const m = matchSupplier(clean, all);
  if (m) return m.id;
  // Plusieurs fiches proches => ne pas créer de doublon, laisser à régulariser.
  const close = all.filter((s) => { const sn = normName(s.name); return sn.length >= 3 && (sn.includes(n) || n.includes(sn)); });
  if (close.length) return null;
  const { data: created, error } = await supabase.from("suppliers").insert({ name: clean.toUpperCase() }).select("id").single();
  if (error) throw new Error(`Création du fournisseur « ${clean} » impossible : ${error.message}`);
  return created.id;
}
