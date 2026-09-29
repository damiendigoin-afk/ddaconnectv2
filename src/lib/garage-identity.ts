/**
 * Coordonnées propres aux garages DDA (multi-sites) — jamais des données client.
 * Sert au scan OR papier : l'en-tête du garage imprimé sur l'OR ne doit ni remplir
 * la fiche client ni servir au rapprochement. Pur, testable.
 * Complété à l'exécution par les données du site actif (sites.email_from_address, phone, address, legal_name).
 */
export type GarageIdentity = { emails: string[]; domains: string[]; phones: string[]; addresses: string[]; names: string[] };

export const GARAGE_ALIASES: GarageIdentity = {
  emails: ["contact@dda-lalinde.fr", "contact@garagecastillon.fr"],
  domains: ["dda-lalinde.fr", "garagecastillon.fr"],
  phones: ["0553247718"],
  addresses: ["27 avenue eugene leroy"],
  names: ["damien digoin automobile", "sas damien digoin automobile", "garage castillon veyssiere", "dda"],
};

export type SiteLike = { name?: string | null; legal_name?: string | null; email_from_address?: string | null; phone?: string | null; address?: string | null } | null | undefined;

export const normText = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const normPhone = (v: unknown): string => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^(0033|33)(?=\d{9}$)/, "0");
  return d.length === 9 ? `0${d}` : d;
};

export function garageIdentity(site?: SiteLike): GarageIdentity {
  const g: GarageIdentity = { emails: [...GARAGE_ALIASES.emails], domains: [...GARAGE_ALIASES.domains], phones: [...GARAGE_ALIASES.phones], addresses: [...GARAGE_ALIASES.addresses], names: [...GARAGE_ALIASES.names] };
  if (site?.email_from_address) {
    const e = site.email_from_address.toLowerCase().trim();
    g.emails.push(e);
    const dom = e.split("@")[1];
    if (dom && !/^(gmail|hotmail|outlook|yahoo|orange|free|sfr|wanadoo|laposte|icloud)\./.test(dom)) g.domains.push(dom);
  }
  if (site?.phone) g.phones.push(normPhone(site.phone));
  if (site?.address) g.addresses.push(normText(site.address));
  for (const n of [site?.legal_name, site?.name]) if (n && normText(n).length >= 6) g.names.push(normText(n));
  return g;
}

export function isGarageEmail(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const e = String(v ?? "").toLowerCase().trim();
  if (!e) return false;
  return g.emails.includes(e) || g.domains.some((d) => e.endsWith(`@${d}`));
}
export function isGaragePhone(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const p = normPhone(v);
  return p.length >= 9 && g.phones.includes(p);
}
export function isGarageAddress(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const a = normText(v);
  return !!a && g.addresses.includes(a);
}
export function isGarageName(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const n = normText(v);
  return !!n && g.names.some((x) => x.length >= 3 && (n === x || (x.length >= 10 && n.includes(x))));
}

/** Retire de la partie client toute coordonnée du garage (ignorée silencieusement, sans conflit). */
export function stripGarageContacts(client: Record<string, unknown>, site?: SiteLike): Record<string, unknown> {
  const g = garageIdentity(site);
  const out = { ...client };
  if (isGarageEmail(out["email"], g)) delete out["email"];
  for (const k of ["phone", "mobile"]) if (isGaragePhone(out[k], g)) delete out[k];
  if (isGarageAddress(out["address"], g)) { delete out["address"]; delete out["postal_code"]; delete out["city"]; }
  const full = [out["last_name"], out["first_name"]].filter(Boolean).join(" ");
  if (isGarageName(out["last_name"], g) || isGarageName(full, g)) { delete out["last_name"]; delete out["first_name"]; delete out["account_number"]; }
  return out;
}
