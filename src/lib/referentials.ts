/** Référentiels partagés : assurances, cabinets, experts, agréments, fournisseurs. */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Insurer = Database["public"]["Tables"]["insurers"]["Row"];
export type ExpertFirm = Database["public"]["Tables"]["expert_firms"]["Row"];
export type Expert = Database["public"]["Tables"]["experts"]["Row"];
export type Agreement = Database["public"]["Tables"]["agreements"]["Row"];
export type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];
export type Site = Database["public"]["Tables"]["sites"]["Row"];

export function expertName(e: Pick<Expert, "first_name" | "last_name"> | null): string {
  if (!e) return "—";
  return [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
}

export async function listInsurers() {
  const { data } = await supabase.from("insurers").select("*").order("name");
  return (data ?? []) as Insurer[];
}
export async function listFirms() {
  const { data } = await supabase.from("expert_firms").select("*").order("name");
  return (data ?? []) as ExpertFirm[];
}
export async function listExperts() {
  const { data } = await supabase.from("experts").select("*").order("last_name");
  return (data ?? []) as Expert[];
}
export async function listAgreements() {
  const { data } = await supabase.from("agreements").select("*").order("name");
  return (data ?? []) as Agreement[];
}
export async function listSuppliers() {
  const { data } = await supabase.from("suppliers").select("*").order("name");
  return (data ?? []) as Supplier[];
}
export async function listSites() {
  const { data } = await supabase.from("sites").select("*").order("name");
  return (data ?? []) as Site[];
}

/** Adresse e-mail à utiliser pour un envoi expert selon le contexte. */
export function expertEmailFor(
  kind: "ead" | "complement" | "default",
  expert: Expert | null,
  firm: ExpertFirm | null,
): string {
  if (kind === "ead") return expert?.ead_email || firm?.ead_email || expert?.email || firm?.email || "";
  if (kind === "complement") return expert?.supplement_email || expert?.email || firm?.email || "";
  return expert?.email || firm?.email || "";
}
