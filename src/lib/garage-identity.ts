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
  phones: ["0553247718", "0553292023"],
  addresses: ["27 avenue eugene leroy", "1340 route de beynac"],
  names: ["damien digoin automobile", "sas damien digoin automobile", "garage castillon veyssiere", "sas castillon veyssiere", "castillon veyssiere", "sas sastillon", "sastillon veyssiere", "dda"],
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

/** Débuts d'en-tête garage reconnus même tronqués par l'OCR (« SAS DAMIEN », « SAS DAMIEN DIGOIN A »). */
export const GARAGE_NAME_STEMS = ["sas damien", "damien digoin", "digoin automobile", "sas castillon", "garage castillon", "castillon veyssi", "sas sastillon", "sastillon veyssi"];
/** Comptes WinMotor internes au garage (jamais un client). */
export const GARAGE_INTERNAL_ACCOUNTS = ["004238"];

export function isGarageEmail(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const e = String(v ?? "").toLowerCase().trim();
  if (!e) return false;
  return g.emails.includes(e) || g.domains.some((d) => e.endsWith(`@${d}`));
}
/** Numéro du garage, y compris mal lu d'un seul chiffre (« 05 52 24 77 18 » pour 05 53 24 77 18). */
export function isGaragePhone(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const p = normPhone(v);
  if (p.length < 9) return false;
  return g.phones.some((x) => x === p || isNearPhone(p, x));
}
export function isNearPhone(a: string, b: string): boolean {
  if (a.length !== 10 || b.length !== 10) return false;
  let diff = 0;
  for (let i = 0; i < 10; i++) if (a[i] !== b[i]) diff++;
  return diff <= 1;
}
export function isGarageAddress(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const a = normText(v);
  return !!a && g.addresses.includes(a);
}
export function isGarageName(v: unknown, g: GarageIdentity = GARAGE_ALIASES): boolean {
  const n = normText(v);
  if (!n) return false;
  if (GARAGE_NAME_STEMS.some((s) => n.startsWith(s) || (s.length >= 12 && n.includes(s)))) return true;
  return g.names.some((x) => x.length >= 3 && (n === x || (x.length >= 10 && n.includes(x))));
}

/** Coupe la fin d'en-tête garage collée à un nom (« RÉGIS O.A.M SAS DAMIEN DIGOIN A » -> « RÉGIS O.A.M »). */
export function cutGarageTail(v: unknown, g: GarageIdentity = GARAGE_ALIASES): { value: string | null; cut: boolean } {
  const s = String(v ?? "").trim();
  if (!s) return { value: null, cut: false };
  const starts = (t: string) => {
    const n = normText(t);
    return !!n && (GARAGE_NAME_STEMS.some((x) => n.startsWith(x)) || g.names.some((x) => x.length >= 6 && n.startsWith(x)) || g.names.includes(n));
  };
  const toks = s.split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    if (starts(toks.slice(i).join(" "))) return { value: i ? toks.slice(0, i).join(" ") : null, cut: true };
  }
  if (isGarageName(s, g)) return { value: null, cut: true };
  return { value: s, cut: false };
}

/** Retire du nom de famille un prénom recopié (« AUDOIN VERONIQUE » + « VERONIQUE » -> « AUDOIN »). */
export function dedupeFirstNameInLastName(last: unknown, first: unknown): string | null {
  const ln = String(last ?? "").trim();
  const fn = normText(first);
  if (!ln) return null;
  if (!fn) return ln;
  const fnToks = new Set(fn.split(" "));
  const kept = ln.split(/\s+/).filter((t) => !fnToks.has(normText(t)));
  return kept.length && kept.length < ln.split(/\s+/).length ? kept.join(" ") : ln;
}

/**
 * Retire de la partie client toute coordonnée du garage (ignorée silencieusement, sans conflit).
 * Un nom garage ne supprime que le champ concerné : prénom, n° de compte et coordonnées restent
 * pour le rapprochement (même site) ou le brouillon de capture — jamais pour créer une fiche.
 */
export function stripGarageContacts(client: Record<string, unknown>, site?: SiteLike): Record<string, unknown> {
  const g = garageIdentity(site);
  const out = { ...client };
  if (isGarageEmail(out["email"], g)) delete out["email"];
  for (const k of ["phone", "mobile"]) if (isGaragePhone(out[k], g)) delete out[k];
  if (isGarageAddress(out["address"], g)) { delete out["address"]; delete out["postal_code"]; delete out["city"]; }
  for (const k of ["last_name", "first_name"]) {
    if (out[k] == null) continue;
    const r = cutGarageTail(out[k], g);
    if (r.value) out[k] = r.value; else delete out[k];
  }
  if (GARAGE_INTERNAL_ACCOUNTS.includes(String(out["account_number"] ?? "").trim())) delete out["account_number"];
  if (out["last_name"] && out["first_name"]) out["last_name"] = dedupeFirstNameInLastName(out["last_name"], out["first_name"]);
  return out;
}

export type ClientSuspicion = "nom_garage" | "telephone_garage" | "adresse_date" | "prenom_double" | "client_absent";
export const SUSPICION_LABELS: Record<ClientSuspicion, string> = {
  nom_garage: "Nom contenant l'en-tête du garage",
  telephone_garage: "Téléphone du garage (ou mal lu)",
  adresse_date: "Adresse commençant par une date",
  prenom_double: "Prénom recopié dans le nom",
  client_absent: "Aucun client rattaché",
};

/** Signale une fiche client déjà enregistrée qui semble polluée (pur, sans correction automatique). */
export function clientSuspicions(c: Record<string, unknown> | null | undefined, site?: SiteLike): ClientSuspicion[] {
  if (!c) return ["client_absent"];
  const g = garageIdentity(site);
  const out: ClientSuspicion[] = [];
  const ln = c["last_name"], fn = c["first_name"];
  if (cutGarageTail(ln, g).cut || cutGarageTail(fn, g).cut) out.push("nom_garage");
  if (isGaragePhone(c["phone"], g) || isGaragePhone(c["mobile"], g)) out.push("telephone_garage");
  if (/^\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{1,4}\s/.test(String(c["address"] ?? ""))) out.push("adresse_date");
  const d = dedupeFirstNameInLastName(ln, fn);
  if (ln && d !== String(ln).trim()) out.push("prenom_double");
  return out;
}
