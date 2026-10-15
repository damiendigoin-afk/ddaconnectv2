import { supabase } from "@/integrations/supabase/client";

export type SiteCode = "castillon" | "dda";
export type SiteScope = "site" | "groupe";

export type Site = {
  id: string;
  code: string | null;
  name: string;
  legal_name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  logo_url: string | null;
  email_from_address: string;
  /** E-mail de contact imprimé sur les documents client ; jamais remplacé par l'expéditeur technique. */
  contact_email?: string | null;
  email_from_name: string;
  active: boolean;
  is_default: boolean;
};

export const GROUP_LABEL = "St Cyprien & Lalinde";

export const SITE_LABELS: Record<string, string> = {
  castillon: "Castillon",
  dda: "DDA / Lalinde",
};

export async function fetchSites(): Promise<Site[]> {
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, code, name, legal_name, address, postal_code, city, phone, logo_url, email_from_address, contact_email, email_from_name, active, is_default",
    )
    .order("name");
  if (error) throw error;
  return (data ?? []) as Site[];
}

/** Déduit un site depuis l'adresse e-mail (jamais bloquant, toujours modifiable). */
export function guessSiteCode(email: string | null | undefined): SiteCode | null {
  const v = (email ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("castillon") || v.includes("veyssiere") || v.includes("stcyprien")) return "castillon";
  if (v.includes("lalinde") || v.includes("dda") || v.includes("digoin")) return "dda";
  return null;
}

export function siteHeader(site: Site | null): { title: string; lines: string[] } {
  if (!site) return { title: GROUP_LABEL, lines: [] };
  return {
    title: site.legal_name || site.name,
    lines: [
      [site.address, [site.postal_code, site.city].filter(Boolean).join(" ")].filter(Boolean).join(" — "),
      site.phone ?? "",
      siteContactEmail(site) ?? "",
    ].filter(Boolean),
  };
}

/**
 * E-mail de contact du site émetteur. Uniquement `contact_email` du site :
 * jamais `email_from_address` (expéditeur technique partagé, domaine Castillon),
 * pour éviter d'imprimer l'adresse d'un autre site.
 */
export function siteContactEmail(site: Pick<Site, "contact_email"> | null | undefined): string | null {
  const e = (site?.contact_email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
