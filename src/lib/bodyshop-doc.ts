/**
 * Identification par document en carrosserie (et autres écrans DocIdentify) :
 * - aiguillage vers le moteur OR atelier (ocrRepairOrder + sanitizeRepairOrder) quand le document
 *   ressemble à un ordre de réparation, sinon moteur générique (ocrAnyDocument) ;
 * - mapping du résultat imbriqué client/vehicle/order vers le contrat plat DocExtract ;
 * - comparaison document / référentiel sans remplacement silencieux.
 * Fonctions pures : testées dans src/lib/__tests__/bodyshop-doc.test.ts.
 */
import { isOrFreeTextForeign, stripOrAdminLabels } from "./doc-rules";
import { formatPlate, normalizePlate, strictPlate } from "./plate";

export type DocExtract = {
  doc_kind?: string | null;
  /** Moteur utilisé : "repair_order" (moteur OR atelier) ou "any_document". */
  engine?: "repair_order" | "any_document";
  plate?: string | null;
  vin?: string | null;
  or_number?: string | null;
  claim_number?: string | null;
  mission_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_account?: string | null;
  customer_address?: string | null;
  brand?: string | null;
  model?: string | null;
  /** Libellé véhicule prêt à afficher (marque fiable + modèle exact). */
  vehicle_label?: string | null;
  first_registration?: string | null;
  mileage?: number | null;
  insurer?: string | null;
  document_date?: string | null;
  summary?: string | null;
  /** Remarques client + travaux, retours ligne conservés. */
  comments?: string | null;
  /** Champs à vérifier (illisibles, rejetés ou douteux). */
  uncertain?: string[];
};

const OR_TITLE = /ordre\s+de\s+r[ée]paration/i;
const OR_MARKERS = [
  /remarques?\s+du\s+client/i,
  /travaux\s+[àa]\s+effectuer/i,
  /n[°o]\s*(de\s+)?compte/i,
  /accueilli\s+par|votre\s+conseiller/i,
  /date\s+(d['’])?entr[ée]e|restitution/i,
  /\bwin\s?motor\b/i,
];

/** Indices de contenu ET de nom de fichier (jamais le seul titre). */
export function looksLikeRepairOrder(text: string | null | undefined, filename?: string | null): boolean {
  const name = (filename ?? "").toLowerCase();
  const nameHit = /ordre\s*de\s*r[ée]paration|(^|[^a-z])or[\s_-]*\d{3,}/i.test(name);
  const t = text ?? "";
  const markers = OR_MARKERS.filter((r) => r.test(t)).length;
  if (OR_TITLE.test(t) && markers >= 1) return true;
  if (markers >= 3) return true;
  return nameHit && (markers >= 1 || t.trim().length < 40);
}

/** Coupe les conditions générales (pages 3–4) : jamais lues comme données métier. */
export function stripGeneralConditions(text: string): string {
  const i = text.search(/conditions\s+g[ée]n[ée]rales(\s+de\s+(vente|r[ée]paration))?/i);
  return i > 200 ? text.slice(0, i) : text;
}

const GARAGE_WORDS = /\b(SAS|SARL|EURL|SIRET|RCS|APE|TVA|AGENT|GARAGE|FAX|CONSEILLER|ACCUEILLI|RENAULT\s+CARE)\b/i;
const GARAGE_DOMAINS = /(digoin|castillon|veyssi|renault|dacia|winmotor|reseau)/i;

const digits = (s: string) => s.replace(/\D/g, "");

/** Téléphones/e-mails présents sur une ligne d'en-tête garage / conseiller. */
export function garageContacts(text: string): { phones: Set<string>; emails: Set<string> } {
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!GARAGE_WORDS.test(line)) continue;
    for (const m of line.matchAll(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g)) phones.add(digits(m[0]).replace(/^33/, "0"));
    for (const m of line.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) emails.add(m[0].toLowerCase());
  }
  return { phones, emails };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Constructeur déduit du VIN (WMI) : sert à refuser une marque d'en-tête garage. */
const WMI: Record<string, string> = {
  VF1: "RENAULT", VF6: "RENAULT", VF2: "RENAULT", UU1: "DACIA", VR1: "DS", VF3: "PEUGEOT", VR3: "PEUGEOT",
  VF7: "CITROEN", VR7: "CITROEN", ZFA: "FIAT", WVW: "VOLKSWAGEN", WAU: "AUDI", VSS: "SEAT", TMB: "SKODA",
  WF0: "FORD", W0L: "OPEL", VXK: "OPEL", SJN: "NISSAN", VNK: "TOYOTA",
};
export function vinMake(vin: string | null | undefined): string | null {
  return vin && vin.length === 17 ? (WMI[vin.slice(0, 3).toUpperCase()] ?? null) : null;
}

export function cleanVin(v: unknown): string | null {
  const s = (str(v) ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? s : null;
}

function cleanPhone(v: unknown, garage: Set<string>): string | null {
  const s = str(v);
  if (!s) return null;
  const d = digits(s).replace(/^33/, "0");
  if (!/^0[1-9]\d{8}$/.test(d) || garage.has(d)) return null;
  return d;
}

function cleanEmail(v: unknown, garage: Set<string>): string | null {
  const s = (str(v) ?? "").toLowerCase();
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return null;
  if (garage.has(s) || GARAGE_DOMAINS.test(s.split("@")[1] ?? "")) return null;
  return s;
}

/** Civilité lue dans le texte juste devant le nom du client. */
function civility(text: string, lastName: string | null): string | null {
  if (!lastName) return null;
  const esc = lastName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\b(MME|MLLE|MR|M\\.|M|MONSIEUR|MADAME)\\s+${esc}\\b`, "i").exec(text);
  if (!m) return null;
  const c = m[1]!.toUpperCase();
  return c.startsWith("MME") || c === "MADAME" ? "Mme" : c === "MLLE" ? "Mlle" : "M.";
}

function freeText(v: unknown, names: unknown[]): string | null {
  const s = str(v);
  if (!s) return null;
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isOrFreeTextForeign(l, names));
  return lines.length ? lines.join("\n") : null;
}

/** Résultat imbriqué du moteur OR atelier -> contrat plat DocExtract. */
export function mapRepairOrderExtract(parsed: unknown, sourceText = ""): DocExtract {
  const p = obj(parsed);
  const c = obj(p["client"]);
  const v = obj(p["vehicle"]);
  const o = obj(p["order"]);
  const uncertain = new Set<string>(Array.isArray(p["uncertain"]) ? (p["uncertain"] as string[]) : []);
  const garage = garageContacts(sourceText);

  const plate = strictPlate(v["plate"]);
  if (v["plate"] && !plate) uncertain.add("vehicle.plate");
  const vin = cleanVin(v["vin"]);
  if (v["vin"] && !vin) uncertain.add("vehicle.vin");

  const last = str(c["last_name"]);
  const first = str(c["first_name"]);
  const civ = civility(sourceText, last);
  const name = last ? [civ, last, first].filter(Boolean).join(" ") : null;

  const mobile = cleanPhone(c["mobile"], garage.phones);
  const phone = mobile ?? cleanPhone(c["phone"], garage.phones);
  if ((c["mobile"] || c["phone"]) && !phone) uncertain.add("client.phone");
  const email = cleanEmail(c["email"], garage.emails);
  if (c["email"] && !email) uncertain.add("client.email");

  const model = str(v["model"]);
  let brand = str(v["brand"])?.toUpperCase() ?? null;
  const make = vinMake(vin);
  // Marque d'en-tête (« AGENT RENAULT ») contredite par le VIN ou par le modèle : écartée.
  if (brand && make && brand !== make) brand = make;
  if (brand && model && model.toUpperCase().startsWith(brand)) brand = null;
  if (!brand && make && model && !model.toUpperCase().startsWith(make)) brand = make;
  const label = [brand, model].filter(Boolean).join(" ") || null;

  const names = [last, first];
  const remarks = freeText(o["client_remarks"], names);
  const work = freeText(o["requested_work"], names);
  const comments =
    [remarks ? `Remarques du client :\n${remarks}` : null, work ? `Travaux à effectuer :\n${work}` : null]
      .filter(Boolean)
      .join("\n\n") || null;

  const address = [str(c["address"]), str(c["address_extra"]), [str(c["postal_code"]), str(c["city"])].filter(Boolean).join(" ")]
    .map((x) => (x ? stripOrAdminLabels(x).replace(/\n+/g, ", ") : x))
    .filter(Boolean)
    .join(", ") || null;

  const mileage = typeof v["mileage"] === "number" ? v["mileage"] : Number(digits(String(v["mileage"] ?? ""))) || null;

  return {
    doc_kind: "or",
    engine: "repair_order",
    plate: plate ? formatPlate(plate) : null,
    vin,
    or_number: str(o["or_number"]) ? digits(String(o["or_number"])) || str(o["or_number"]) : null,
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    customer_account: str(c["account_number"]),
    customer_address: address,
    brand,
    model,
    vehicle_label: label,
    first_registration: str(v["first_registration"]),
    mileage,
    document_date: str(o["or_date"]),
    comments,
    // Un OR WinMotor ne contient ni assureur ni sinistre : jamais déduits.
    insurer: null,
    claim_number: null,
    mission_number: null,
    uncertain: [...uncertain],
  };
}

export type RefFields = Record<string, string>;
export type FieldConflict = { field: "plate" | "vin" | "customer_name" | "customer_phone" | "customer_email"; label: string; doc: string; base: string };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9@.]/g, "");

const CIVILITIES = new Set(["M", "MR", "MME", "MLLE", "MONSIEUR", "MADAME", "MADEMOISELLE"]);
const nameTokens = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[^A-Z]+/).filter((t) => t && !CIVILITIES.has(t));

/** Nom ET prénom comparés (civilité, accents, ordre et tirets ignorés). */
export function sameCustomer(docName: string, lastName: string, firstName: string): boolean {
  const doc = new Set(nameTokens(docName));
  const base = [...nameTokens(lastName), ...nameTokens(firstName)];
  if (!base.length) return true;
  return base.every((t) => doc.has(t)) && nameTokens(docName).every((t) => base.includes(t));
}

/** Divergences document / référentiel — affichées, jamais résolues en silence. */
export function compareWithRef(e: DocExtract, ref: RefFields | null | undefined): FieldConflict[] {
  if (!ref) return [];
  const out: FieldConflict[] = [];
  const push = (field: FieldConflict["field"], label: string, doc: string | null | undefined, base: string | null | undefined, eq: (a: string, b: string) => boolean) => {
    if (doc && base && !eq(doc, base)) out.push({ field, label, doc, base });
  };
  push("plate", "Immatriculation", e.plate, ref["plate"], (a, b) => normalizePlate(a) === normalizePlate(b));
  push("vin", "VIN", e.vin, ref["vin"], (a, b) => norm(a) === norm(b));
  const baseName = [ref["last_name"], ref["first_name"]].filter(Boolean).join(" ");
  push("customer_name", "Client", e.customer_name, baseName, () => sameCustomer(e.customer_name ?? "", ref["last_name"] ?? "", ref["first_name"] ?? ""));
  push("customer_phone", "Téléphone", e.customer_phone, ref["mobile"] || ref["phone"], (a, b) => digits(a) === digits(b) || digits(a) === digits(ref["phone"] ?? ""));
  push("customer_email", "E-mail", e.customer_email, ref["email"], (a, b) => a.toLowerCase() === b.toLowerCase());
  return out;
}

export type CaseFormPrefill = {
  plate: string;
  vin: string;
  vehicleLabel: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  orNumber: string;
  claim: string;
  comments: string;
  /** Liaison référentiel seulement si immat ET VIN ne divergent pas. */
  linkRef: boolean;
  conflicts: FieldConflict[];
  /** Champs remplis depuis la base faute de valeur dans le document. */
  fromBase: string[];
  /** Catégorie de rangement de la pièce jointe. */
  docCategory: string;
};

const DOC_CATEGORY: Record<string, string> = {
  plaque: "vehicule",
  carte_grise: "vehicule",
  or: "or",
  avis_sinistre: "sinistre",
  rapport_expertise: "expertise",
};
export const docCategory = (kind: string | null | undefined) => DOC_CATEGORY[kind ?? ""] ?? "autres";

/** Document prioritaire ; la base ne complète que les vides. Grêle/VGE/payeur/origine jamais touchés. */
export function buildCaseFormPrefill(e: DocExtract, ref: RefFields | null | undefined): CaseFormPrefill {
  const conflicts = compareWithRef(e, ref);
  const fromBase: string[] = [];
  const pick = (doc: string | null | undefined, base: string | null | undefined, key: string) => {
    if (doc) return doc;
    if (base) {
      fromBase.push(key);
      return base;
    }
    return "";
  };
  const r = ref ?? {};
  const baseName = [r["last_name"], r["first_name"]].filter(Boolean).join(" ");
  const baseLabel = [r["brand"], r["model"]].filter(Boolean).join(" ");
  const label = e.vehicle_label ?? ([e.brand, e.model].filter(Boolean).join(" ") || null);
  return {
    plate: e.plate ? formatPlate(e.plate) : r["plate"] ? formatPlate(r["plate"]) : "",
    vin: pick(e.vin, r["vin"], "VIN"),
    vehicleLabel: pick(label, baseLabel, "Véhicule"),
    customerName: pick(e.customer_name, baseName, "Client"),
    customerPhone: pick(e.customer_phone, r["mobile"] || r["phone"], "Téléphone"),
    customerEmail: pick(e.customer_email, r["email"], "E-mail"),
    orNumber: e.or_number ?? "",
    claim: e.claim_number ?? "",
    comments: e.comments ?? "",
    linkRef: Boolean(ref) && !conflicts.some((c) => c.field === "plate" || c.field === "vin"),
    conflicts,
    fromBase,
    docCategory: docCategory(e.doc_kind),
  };
}

export type IdentityValues = {
  plate: string; vin: string; vehicleLabel: string; customerName: string;
  customerPhone: string; customerEmail: string; orNumber: string; claim: string;
};
export const IDENTITY_LABELS: Record<keyof IdentityValues, string> = {
  plate: "Immatriculation", vin: "VIN", vehicleLabel: "Véhicule", customerName: "Client",
  customerPhone: "Téléphone", customerEmail: "E-mail", orNumber: "N° OR", claim: "N° de sinistre",
};

/**
 * Nouveau document : remplace les valeurs venues du document précédent (y compris par du vide,
 * pas de valeur périmée) ; une saisie manuelle (différente du document précédent) est conservée
 * et signalée si le nouveau document propose autre chose.
 */
export function mergeDocumentValues(
  current: IdentityValues,
  previousDoc: IdentityValues | null,
  next: IdentityValues,
): { values: IdentityValues; keptManual: (keyof IdentityValues)[] } {
  const values = { ...current };
  const keptManual: (keyof IdentityValues)[] = [];
  for (const k of Object.keys(IDENTITY_LABELS) as (keyof IdentityValues)[]) {
    const cur = current[k].trim();
    const fromPrev = previousDoc ? previousDoc[k].trim() : "";
    const manual = cur !== "" && cur !== fromPrev;
    if (!manual) values[k] = next[k];
    else if (next[k] && next[k].trim() !== cur) keptManual.push(k);
  }
  return { values, keptManual };
}
