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
      "id, code, name, legal_name, address, postal_code, city, phone, logo_url, email_from_address, email_from_name, active, is_default",
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
      site.email_from_address ?? "",
    ].filter(Boolean),
  };
}
