/**
 * Dossier carrosserie ↔ référentiel (fiches client / véhicule).
 * - brouillons de fiches construits UNIQUEMENT depuis les valeurs du dossier (aucune invention) ;
 * - recherche de doublons (plaque, VIN, compte WinMotor, nom + coordonnées) ;
 * - décision : correspondance certaine (rattacher) / choix explicite / création ;
 * - création et rattachement sur clic utilisateur, sans jamais créer d'OR.
 * Logique pure testée dans src/lib/__tests__/bodyshop-link.test.ts.
 */
import { normalizeEmail, normalizeName, normalizePhone, normalizeRegistration, normalizeVin } from "./winmotor/mapping";

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type CaseLinkSource = {
  id: string;
  site_id: string | null;
  plate: string | null;
  vin: string | null;
  vehicle_label: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_account?: string | null;
  customer_address?: string | null;
  customer_id: string | null;
  ref_vehicle_id: string | null;
};

export type CustomerDraft = {
  civility: string;
  last_name: string;
  first_name: string;
  company_name: string;
  customer_type: "individual" | "company";
  account: string;
  mobile: string;
  phone: string;
  email: string;
  address_line_1: string;
  postal_code: string;
  city: string;
};

export type VehicleDraft = { registration: string; vin: string; brand: string; model: string };

const CIVILITIES = /^(M\.|MR|MONSIEUR|MME|MADAME|MLLE|MADEMOISELLE|M)\.?\s+/i;
const COMPANY = /\b(SARL|SAS|SASU|EURL|SA|SCI|SNC|GARAGE|STE|SOCIETE|SOCIÉTÉ|ETS|EARL|GAEC|ASSOCIATION|MAIRIE|COMMUNE)\b/i;

/** « Mme VERNET ISABELLE » (ordre WinMotor NOM Prénom) → civilité / nom / prénom. */
export function parseCaseCustomerName(raw: string | null | undefined): Pick<CustomerDraft, "civility" | "last_name" | "first_name" | "company_name" | "customer_type"> {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  const empty = { civility: "", last_name: "", first_name: "", company_name: "", customer_type: "individual" as const };
  if (!s) return empty;
  if (COMPANY.test(s)) return { ...empty, company_name: s, customer_type: "company" };
  let civility = "";
  const m = s.match(CIVILITIES);
  if (m) {
    const c = m[1]!.toUpperCase().replace(".", "");
    civility = c === "MME" || c === "MADAME" ? "Mme" : c === "MLLE" || c === "MADEMOISELLE" ? "Mlle" : "M.";
    s = s.slice(m[0].length).trim();
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { ...empty, civility, last_name: parts[0]! };
  // Nom en majuscules en tête (plusieurs mots possibles), prénom ensuite.
  const firstLower = parts.findIndex((p) => p !== p.toUpperCase());
  if (firstLower > 0) return { ...empty, civility, last_name: parts.slice(0, firstLower).join(" "), first_name: parts.slice(firstLower).join(" ") };
  return { ...empty, civility, last_name: parts.slice(0, -1).join(" "), first_name: parts[parts.length - 1]! };
}

/** « 3 RUE PORTE CAMPAN, 24540 MONTPAZIER » → ligne / CP / ville. Rien d'inventé si absent. */
export function parseCaseAddress(raw: string | null | undefined): Pick<CustomerDraft, "address_line_1" | "postal_code" | "city"> {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { address_line_1: "", postal_code: "", city: "" };
  const m = s.match(/^(.*?)[,\s]+(\d{5})\s+(.+)$/);
  if (!m) return { address_line_1: s, postal_code: "", city: "" };
  return { address_line_1: m[1]!.replace(/[,\s]+$/, ""), postal_code: m[2]!, city: m[3]!.trim() };
}

export function isMobile(phone: string): boolean {
  return /^0[67]\d{8}$/.test(normalizePhone(phone));
}

export function customerDraftFromCase(c: CaseLinkSource): CustomerDraft {
  const phone = (c.customer_phone ?? "").trim();
  const email = normalizeEmail(c.customer_email ?? "");
  return {
    ...parseCaseCustomerName(c.customer_name),
    ...parseCaseAddress(c.customer_address),
    account: (c.customer_account ?? "").trim(),
    mobile: phone && isMobile(phone) ? phone : "",
    phone: phone && !isMobile(phone) ? phone : "",
    email,
  };
}

/** Marque = premier mot seulement si le libellé est une marque connue ; sinon libellé exact en modèle. */
const BRANDS = ["RENAULT", "DACIA", "PEUGEOT", "CITROEN", "DS", "OPEL", "FIAT", "FORD", "VOLKSWAGEN", "VW", "TOYOTA", "NISSAN", "SEAT", "SKODA", "AUDI", "BMW", "MERCEDES", "KIA", "HYUNDAI", "SUZUKI", "MINI", "VOLVO", "TESLA", "MAZDA", "HONDA", "JEEP", "ALFA"];
export function vehicleDraftFromCase(c: CaseLinkSource): VehicleDraft {
  const label = (c.vehicle_label ?? "").replace(/\s+/g, " ").trim();
  const first = label.split(" ")[0]?.toUpperCase() ?? "";
  // « DS3 CROSSBACK » : DS est la marque, le libellé complet reste le modèle (pas de « Renault » déduit).
  const ds = /^DS\d/.test(first);
  const brand = BRANDS.includes(first) ? first : ds ? "DS" : "";
  const model = BRANDS.includes(first) ? label.slice(first.length).trim() : label;
  return { registration: normalizeRegistration(c.plate ?? ""), vin: normalizeVin(c.vin ?? ""), brand, model };
}

/* ---------------- Décision de rattachement ---------------- */

export type VehCandidate = { id: string; registration_normalized: string | null; vin_normalized?: string | null; vin?: string | null; site_id: string | null; brand?: string | null; model?: string | null; range_name?: string | null };
export type CustCandidate = {
  id: string;
  source_customer_id: string | null;
  last_name: string | null;
  first_name: string | null;
  company_name: string | null;
  site_id: string | null;
  contacts?: string[];
  ownerOfVehicle?: boolean;
};
export type Match<T> = { candidate: T; certain: boolean; reasons: string[]; conflicts: string[] };

export function rankVehicleCandidates(d: VehicleDraft, list: VehCandidate[]): Match<VehCandidate>[] {
  const out: Match<VehCandidate>[] = [];
  for (const v of list) {
    const vVin = normalizeVin(v.vin_normalized ?? v.vin ?? "");
    const reasons: string[] = [];
    const conflicts: string[] = [];
    const plateEq = !!d.registration && v.registration_normalized === d.registration;
    const vinEq = !!d.vin && vVin === d.vin;
    if (plateEq) reasons.push("Immatriculation identique");
    if (vinEq) reasons.push("VIN identique");
    if (d.vin && vVin && !vinEq) conflicts.push("VIN différent");
    if (d.registration && v.registration_normalized && !plateEq) conflicts.push("Immatriculation différente");
    if (!plateEq && !vinEq) continue;
    out.push({ candidate: v, reasons, conflicts, certain: !conflicts.length });
  }
  const certain = out.filter((m) => m.certain);
  // Plusieurs fiches « certaines » = doublon existant : choix explicite.
  if (certain.length > 1) for (const m of certain) m.certain = false;
  return out.sort((a, b) => Number(b.certain) - Number(a.certain) || b.reasons.length - a.reasons.length);
}

function personKey(last: string | null | undefined, first: string | null | undefined): string {
  return [normalizeName(last ?? ""), normalizeName(first ?? "")].filter(Boolean).sort().join("|");
}

export function rankCustomerCandidates(d: CustomerDraft, list: CustCandidate[], siteId: string | null): Match<CustCandidate>[] {
  const draftKey = d.company_name ? normalizeName(d.company_name) : personKey(d.last_name, d.first_name);
  const draftContacts = [normalizePhone(d.mobile), normalizePhone(d.phone), normalizeEmail(d.email)].filter(Boolean);
  const out: Match<CustCandidate>[] = [];
  for (const c of list) {
    const key = c.company_name ? normalizeName(c.company_name) : personKey(c.last_name, c.first_name);
    const nameEq = !!draftKey && key === draftKey;
    const nameConflict = !!draftKey && !!key && !nameEq;
    const accountEq = !!d.account && c.source_customer_id === d.account && (!siteId || !c.site_id || c.site_id === siteId);
    const contactEq = draftContacts.some((x) => (c.contacts ?? []).includes(x));
    const reasons: string[] = [];
    const conflicts: string[] = [];
    if (accountEq) reasons.push(`Compte WinMotor ${d.account}`);
    if (nameEq) reasons.push("Nom et prénom identiques");
    if (contactEq) reasons.push("Téléphone ou e-mail identique");
    if (c.ownerOfVehicle) reasons.push("Propriétaire du véhicule");
    if (nameConflict) conflicts.push("Nom ou prénom différent");
    if (!accountEq && !nameEq && !contactEq && !c.ownerOfVehicle) continue;
    const certain = !conflicts.length && (accountEq || (nameEq && (contactEq || !!c.ownerOfVehicle)));
    out.push({ candidate: c, reasons, conflicts, certain });
  }
  const certain = out.filter((m) => m.certain);
  if (certain.length > 1) for (const m of certain) m.certain = false;
  return out.sort((a, b) => Number(b.certain) - Number(a.certain) || b.reasons.length - a.reasons.length);
}

/* ---------------- Accès base (sur clic) ---------------- */

const orSafe = (v: string) => v.replace(/[,()*%]/g, "");

export async function findVehicleCandidates(db: Db, d: VehicleDraft): Promise<Match<VehCandidate>[]> {
  const f = [d.registration ? `registration_normalized.eq.${orSafe(d.registration)}` : "", d.vin ? `vin_normalized.eq.${orSafe(d.vin)}` : ""].filter(Boolean);
  if (!f.length) return [];
  const { data, error } = await db.from("ref_vehicles").select("id, registration_normalized, vin, vin_normalized, site_id, brand, model, range_name").or(f.join(",")).limit(10);
  if (error) throw error;
  return rankVehicleCandidates(d, (data ?? []) as VehCandidate[]);
}

export async function findCustomerCandidates(db: Db, d: CustomerDraft, siteId: string | null, vehicleId: string | null): Promise<Match<CustCandidate>[]> {
  const ids = new Set<string>();
  const owners = new Set<string>();
  const filters: string[] = [];
  if (d.account) filters.push(`source_customer_id.eq.${orSafe(d.account)}`);
  if (d.last_name) filters.push(`last_name_normalized.eq.${orSafe(normalizeName(d.last_name))}`);
  if (d.company_name) filters.push(`company_normalized.eq.${orSafe(normalizeName(d.company_name))}`);
  const contacts = [normalizePhone(d.mobile), normalizePhone(d.phone), normalizeEmail(d.email)].filter(Boolean);
  const [byFields, byContacts, byOwner] = await Promise.all([
    filters.length ? db.from("customers").select("id").or(filters.join(",")).limit(20) : Promise.resolve({ data: [] }),
    contacts.length ? db.from("customer_contacts").select("customer_id").eq("active", true).in("normalized_value", contacts).limit(20) : Promise.resolve({ data: [] }),
    vehicleId ? db.from("customer_vehicle_relations").select("customer_id").eq("vehicle_id", vehicleId).eq("active", true).eq("relationship_type", "OWNER") : Promise.resolve({ data: [] }),
  ]);
  for (const r of (byFields.data ?? []) as { id: string }[]) ids.add(r.id);
  for (const r of (byContacts.data ?? []) as { customer_id: string }[]) ids.add(r.customer_id);
  for (const r of (byOwner.data ?? []) as { customer_id: string }[]) {
    ids.add(r.customer_id);
    owners.add(r.customer_id);
  }
  if (!ids.size) return [];
  const list = [...ids].slice(0, 40);
  const [{ data: custs }, { data: cts }] = await Promise.all([
    db.from("customers").select("id, source_customer_id, last_name, first_name, company_name, site_id").in("id", list),
    db.from("customer_contacts").select("customer_id, normalized_value").eq("active", true).in("customer_id", list),
  ]);
  const byCust = new Map<string, string[]>();
  for (const c of (cts ?? []) as { customer_id: string; normalized_value: string | null }[]) {
    if (c.normalized_value) byCust.set(c.customer_id, [...(byCust.get(c.customer_id) ?? []), c.normalized_value]);
  }
  const cands = ((custs ?? []) as CustCandidate[]).map((c) => ({ ...c, contacts: byCust.get(c.id) ?? [], ownerOfVehicle: owners.has(c.id) }));
  return rankCustomerCandidates(d, cands, siteId);
}

/** Lien dossier → fiche : seulement si le dossier n'est pas déjà rattaché (anti double-clic / concurrence). */
export async function linkCase(db: Db, caseId: string, field: "customer_id" | "ref_vehicle_id", id: string): Promise<boolean> {
  const { data, error } = await db.from("bodyshop_cases").update({ [field]: id }).eq("id", caseId).is(field, null).select("id");
  if (error) throw error;
  return ((data ?? []) as unknown[]).length > 0;
}

/** Relation propriétaire client ↔ véhicule (idempotente). */
export async function ensureOwnerRelation(db: Db, customerId: string, vehicleId: string) {
  const { error } = await db
    .from("customer_vehicle_relations")
    .upsert({ customer_id: customerId, vehicle_id: vehicleId, relationship_type: "OWNER", active: true, source: "DDA" }, { onConflict: "customer_id,vehicle_id,relationship_type", ignoreDuplicates: true });
  if (error) throw error;
}

export function vehicleInsertRow(d: VehicleDraft, siteId: string | null) {
  return {
    registration_display: d.registration ? formatReg(d.registration) : null,
    registration_normalized: d.registration || null,
    vin: d.vin || null,
    vin_normalized: d.vin || null,
    brand: d.brand || null,
    model: d.model || null,
    site_id: siteId,
    source_system: "dda",
  };
}

function formatReg(r: string): string {
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(r) ? `${r.slice(0, 2)}-${r.slice(2, 5)}-${r.slice(5)}` : r;
}

export function customerInsertRow(d: CustomerDraft, siteId: string | null) {
  return {
    customer_type: d.customer_type,
    civility: d.civility || null,
    last_name: d.last_name || null,
    first_name: d.first_name || null,
    company_name: d.company_name || null,
    last_name_normalized: normalizeName(d.last_name) || null,
    first_name_normalized: normalizeName(d.first_name) || null,
    company_normalized: normalizeName(d.company_name) || null,
    site_id: siteId,
    // Le compte lu sur l'OR EST le n° client WinMotor : même clé que l'import, pas de doublon futur.
    source_system: d.account ? "winmotor" : "dda",
    source_customer_id: d.account || null,
  };
}

export function contactRows(customerId: string, d: Pick<CustomerDraft, "mobile" | "phone" | "email">) {
  const rows: { customer_id: string; type: string; value: string; normalized_value: string; is_primary: boolean; source: string }[] = [];
  const mob = normalizePhone(d.mobile);
  const tel = normalizePhone(d.phone);
  const mail = normalizeEmail(d.email);
  if (mob) rows.push({ customer_id: customerId, type: "MOBILE", value: d.mobile.trim(), normalized_value: mob, is_primary: true, source: "DDA" });
  if (tel && tel !== mob) rows.push({ customer_id: customerId, type: "PHONE", value: d.phone.trim(), normalized_value: tel, is_primary: !mob, source: "DDA" });
  if (mail) rows.push({ customer_id: customerId, type: "EMAIL", value: mail, normalized_value: mail, is_primary: false, source: "DDA" });
  return rows;
}

export async function createVehicleForCase(db: Db, c: CaseLinkSource, d: VehicleDraft): Promise<{ id: string; linked: boolean }> {
  if (!d.registration && !d.vin) throw new Error("Immatriculation ou VIN requis pour créer la fiche véhicule.");
  // Revérification juste avant création : un doublon certain apparu entre-temps est rattaché, jamais recréé.
  const again = await findVehicleCandidates(db, d);
  if (again.length) throw new Error("Une fiche véhicule correspondante existe déjà : rattachez-la plutôt que d'en créer une nouvelle.");
  const { data: fresh } = await db.from("bodyshop_cases").select("ref_vehicle_id").eq("id", c.id).maybeSingle();
  if (fresh?.ref_vehicle_id) return { id: fresh.ref_vehicle_id as string, linked: false };
  const { data, error } = await db.from("ref_vehicles").insert(vehicleInsertRow(d, c.site_id)).select("id").single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const linked = await linkCase(db, c.id, "ref_vehicle_id", id);
  if (c.customer_id) await ensureOwnerRelation(db, c.customer_id, id);
  return { id, linked };
}

export async function createCustomerForCase(db: Db, c: CaseLinkSource, d: CustomerDraft): Promise<{ id: string; linked: boolean }> {
  if (!d.last_name && !d.company_name) throw new Error("Nom du client requis.");
  const again = await findCustomerCandidates(db, d, c.site_id, c.ref_vehicle_id);
  if (again.some((m) => m.certain)) throw new Error("Une fiche client correspondante existe déjà : rattachez-la.");
  const { data: fresh } = await db.from("bodyshop_cases").select("customer_id").eq("id", c.id).maybeSingle();
  if (fresh?.customer_id) return { id: fresh.customer_id as string, linked: false };
  const { data, error } = await db.from("customers").insert(customerInsertRow(d, c.site_id)).select("id").single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const rows = contactRows(id, d);
  if (rows.length) {
    const { error: e2 } = await db.from("customer_contacts").upsert(rows, { onConflict: "customer_id,type,normalized_value", ignoreDuplicates: true });
    if (e2) throw e2;
  }
  if (d.address_line_1 || d.postal_code || d.city) {
    const { error: e3 } = await db.from("customer_addresses").insert({
      customer_id: id,
      address_line_1: d.address_line_1 || null,
      postal_code: d.postal_code || null,
      city: d.city || null,
      country: "FRANCE",
      type: "MAIN",
      source: "DDA",
    });
    if (e3) throw e3;
  }
  const linked = await linkCase(db, c.id, "customer_id", id);
  if (c.ref_vehicle_id) await ensureOwnerRelation(db, id, c.ref_vehicle_id);
  return { id, linked };
}

export async function attachExisting(db: Db, c: CaseLinkSource, kind: "customer" | "vehicle", id: string): Promise<boolean> {
  const linked = await linkCase(db, c.id, kind === "customer" ? "customer_id" : "ref_vehicle_id", id);
  const cust = kind === "customer" ? id : c.customer_id;
  const veh = kind === "vehicle" ? id : c.ref_vehicle_id;
  if (linked && cust && veh) await ensureOwnerRelation(db, cust, veh);
  return linked;
}

/** Message lisible pour les erreurs de droits. */
export function linkErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/row-level security|permission denied|42501/i.test(msg)) return "Droits insuffisants pour créer ou modifier cette fiche (compte inactif ou non autorisé).";
  return msg || "Opération impossible.";
}
