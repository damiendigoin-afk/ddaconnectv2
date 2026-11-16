/**
 * Contrôles déterministes d'une lecture d'OR WinMotor (pure, testable, sans IA).
 * But : bloquer les valeurs impossibles et signaler les doutes, sans imposer de saisie
 * quand la lecture est cohérente. Rien n'est corrigé en silence.
 */
import { formatPlate, normalizePlate, wellFormedPlate } from "./plate";
import { guardFirstRegistration } from "./vehicle-dates";
import { normalizeVin, vinIssueMessage } from "./vin";

/** Modèles distinctifs -> constructeur attendu (liste volontairement courte, sans ambiguïté). */
const MODEL_BRAND: Array<[RegExp, string]> = [
  [/\b(CEED|CEE ?D|SPORTAGE|PICANTO|NIRO|STONIC|XCEED|SORENTO|RIO)(?=\d|\b)/, "KIA"],
  [/\b(NAVARA|QASHQAI|JUKE|MICRA|X-?TRAIL|NOTE|LEAF|PULSAR)(?=\d|\b)/, "NISSAN"],
  [/\b(CLIO|MEGANE|MÉGANE|CAPTUR|KANGOO|TRAFIC|MASTER|SCENIC|SCÉNIC|TWINGO|ZOE|KADJAR|ARKANA|AUSTRAL|ESPACE|LAGUNA|KOLEOS|TALISMAN|RAFALE|SYMBIOZ)(?=\d|\b)/, "RENAULT"],
  [/\b(SANDERO|DUSTER|LOGAN|LODGY|DOKKER|JOGGER|SPRING|BIGSTER)(?=\d|\b)/, "DACIA"],
  [/\b(GOLF|POLO|PASSAT|TIGUAN|TOURAN|T-?ROC|CADDY|TRANSPORTER|UP)(?=\d|\b)/, "VOLKSWAGEN"],
  [/\b(YARIS|COROLLA|AURIS|RAV ?4|AYGO|C-?HR|HILUX|PRIUS)(?=\d|\b)/, "TOYOTA"],
  [/\b(FIESTA|FOCUS|KUGA|TRANSIT|MONDEO|PUMA|RANGER)(?=\d|\b)/, "FORD"],
  [/\b(BERLINGO|PICASSO|C3|C4|C5|JUMPY|JUMPER|SAXO|XSARA)\b/, "CITROEN"],
  [/\b(208|2008|308|3008|508|5008|PARTNER|EXPERT|BOXER|RIFTER)\b/, "PEUGEOT"],
  [/\b(CORSA|ASTRA|MOKKA|ZAFIRA|VIVARO|INSIGNIA|MERIVA)(?=\d|\b)/, "OPEL"],
  [/\b(TUCSON|KONA|I10|I20|I30|SANTA FE|IONIQ)\b/, "HYUNDAI"],
];

const up = (v: unknown) => String(v ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");

export type PlateCheck = "ok" | "empty" | "or_number" | "atypical";

/** Immatriculation : SIV/FNI = ok ; égale au n° d'OR / n° compte = refusée ; autre format = atypique (confirmation). */
export function checkPlate(plate: unknown, others: { orNumber?: unknown; account?: unknown } = {}): PlateCheck {
  const n = normalizePlate(String(plate ?? ""));
  if (!n) return "empty";
  if (/^\d+$/.test(n)) {
    const d = n.replace(/^0+/, "");
    if ((digits(others.orNumber) && d === digits(others.orNumber)) || (digits(others.account) && d === digits(others.account))) return "or_number";
  }
  return wellFormedPlate(n) ? "ok" : "atypical";
}

/** Modèle pollué : e-mail, téléphone, libellé « email/tél », ou texte de plusieurs colonnes collées. */
export function isPollutedModel(model: unknown): boolean {
  const m = String(model ?? "").trim();
  if (!m) return false;
  if (/@|\b(e-?mail|emoil|courriel|mail)\b/i.test(m)) return true;
  if (/\bt[ée]l\b\.?/i.test(m) || /(?:\d[\s.]?){10}/.test(m)) return true;
  return m.length > 40 || m.split(/\s+/).length > 6;
}

/** Constructeur attendu pour un modèle distinctif, sinon null. */
export function expectedBrand(model: unknown): string | null {
  const m = up(model);
  if (!m) return null;
  for (const [re, b] of MODEL_BRAND) if (re.test(m)) return b;
  return null;
}

/** Marque lue incompatible avec le modèle (ex. RENAULT + CEED) : renvoie la marque attendue, sinon null. */
export function brandModelConflict(brand: unknown, model: unknown): string | null {
  const b = up(brand).replace(/^VW$/, "VOLKSWAGEN");
  const e = expectedBrand(model);
  if (!b || !e) return null;
  return b === e || b.startsWith(`${e} `) ? null : e;
}

/** Deux lectures valides de la même plaque qui ne diffèrent que d'un caractère (ex. BK-859-HQ / BK-859-HG). */
export function plateNearMiss(a: unknown, b: unknown): boolean {
  const x = normalizePlate(String(a ?? "")), y = normalizePlate(String(b ?? ""));
  if (!x || !y || x === y || x.length !== y.length || !wellFormedPlate(x) || !wellFormedPlate(y)) return false;
  let d = 0;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) d += 1;
  return d === 1;
}

/** WMI (3 premiers caractères du VIN) -> constructeur. Liste courte, sans ambiguïté. */
const WMI_BRAND: Record<string, string> = {
  VF1: "RENAULT", VF6: "RENAULT", VF8: "RENAULT", UU1: "DACIA", VF3: "PEUGEOT", VR3: "PEUGEOT", VF7: "CITROEN", VR7: "CITROEN", VR1: "DS",
  WF0: "FORD", WF1: "FORD", WVW: "VOLKSWAGEN", WV1: "VOLKSWAGEN", WV2: "VOLKSWAGEN", ZFA: "FIAT", W0L: "OPEL", W0V: "OPEL", VXK: "OPEL",
  TMB: "SKODA", VSS: "SEAT", KNA: "KIA", KNE: "KIA", U5Y: "KIA", KMH: "HYUNDAI", TMA: "HYUNDAI", SJN: "NISSAN", VSK: "NISSAN", JN1: "NISSAN",
  JTD: "TOYOTA", SB1: "TOYOTA", VNK: "TOYOTA", WBA: "BMW", WDD: "MERCEDES", WDB: "MERCEDES", W1K: "MERCEDES", WAU: "AUDI",
};
const BRAND_ALIASES: Record<string, string> = { VW: "VOLKSWAGEN", "MERCEDES-BENZ": "MERCEDES", CITROËN: "CITROEN" };

/** Constructeur attendu d'après le WMI d'un VIN, sinon null. */
export function vinBrand(vin: unknown): string | null {
  const n = normalizeVin(vin);
  const v = n.vin ?? n.candidate;
  return v && v.length >= 3 ? WMI_BRAND[v.slice(0, 3)] ?? null : null;
}

/** Marque lue incompatible avec le WMI du VIN (ex. RENAULT + WF0…) : renvoie la marque attendue. */
export function vinBrandConflict(brand: unknown, vin: unknown): string | null {
  const raw = up(brand);
  const b = BRAND_ALIASES[raw] ?? raw;
  const e = vinBrand(vin);
  if (!b || !e) return null;
  return b === e || b.startsWith(`${e} `) || (e === "DACIA" && b === "RENAULT") ? null : e;
}

const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1)
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
};

/** Modèle générique ou libellé de colonne lu à la place du modèle (« vétioule », « véhicule », « modèle »). */
export function isGenericModel(model: unknown): boolean {
  const m = up(model).replace(/[^A-Z]/g, "");
  if (!m) return false;
  return ["VEHICULE", "VOITURE", "MODELE", "MARQUE", "TYPE"].some((w) => m === w || (w.length >= 6 && m.length >= 5 && lev(m, w) <= 2));
}

/** Mots d'étiquette/article lus comme nom : jamais un vrai nom court (LY, NG, LE ROUX restent acceptés). */
const NAME_STOP = new Set(["LA", "LE", "LES", "DE", "DU", "DES", "MR", "M", "MME", "MLLE", "NOM", "PRENOM", "CLIENT", "SOCIETE", "ADRESSE", "TEL", "PATE"]);

/** Nom/prénom douteux : mot-étiquette, ou prénom tout en minuscules (WinMotor imprime en capitales). */
export function suspiciousName(lastName: unknown, firstName: unknown): string | null {
  const l = up(lastName), f = up(firstName);
  if (l && NAME_STOP.has(l)) return `Nom client « ${String(lastName).trim()} » ressemble à un mot de l'OR, pas à un nom.`;
  if (f && NAME_STOP.has(f)) return `Prénom « ${String(firstName).trim()} » ressemble à un mot de l'OR, pas à un prénom.`;
  const fr = String(firstName ?? "").trim();
  if (fr && /^[a-zà-ÿ]+$/.test(fr)) return `Prénom « ${fr} » lu en minuscules : lecture probablement erronée.`;
  return null;
}

/** Code postal / ville incohérents (CP non 5 chiffres, ville avec chiffres). */
export function addressIssue(client: Record<string, unknown>): string | null {
  const cp = String(client["postal_code"] ?? client["zip"] ?? "").replace(/\s/g, "");
  const city = String(client["city"] ?? "").trim();
  if (cp && !/^\d{5}$/.test(cp)) return `Code postal « ${cp} » invalide.`;
  if (city && /\d/.test(city)) return `Ville « ${city} » contient des chiffres.`;
  return null;
}

export type OrScanDoubt = {
  field: "plate" | "brand" | "model" | "client" | "first_registration" | "vin";
  code: "plate_or_number" | "plate_atypical" | "plate_two_readings" | "model_polluted" | "model_generic" | "brand_model" | "vin_invalid" | "vin_brand" | "client_suspicious" | "address_incoherent" | "client_missing" | "mec_is_delivery" | "mec_invalid" | "ixellio_vin_mismatch" | "ixellio_mec_conflict" | "ixellio_unavailable";
  message: string;
  /** Confirmation explicite requise avant création (sinon simple avertissement modifiable). */
  blocking: boolean;
};

export type OrScanData = { client: Record<string, unknown>; vehicle: Record<string, unknown>; order: Record<string, unknown> };

/**
 * Doutes d'une lecture d'OR avant création/rattachement. Les valeurs impossibles sont retirées
 * (plaque = n° d'OR, modèle pollué) ; les incohérences sont seulement signalées.
 */
export function assessOrScan(input: { data: OrScanData; orNumber: string | null; localPlate?: string | null }): { data: OrScanData; doubts: OrScanDoubt[] } {
  const vehicle = { ...input.data.vehicle };
  const client = { ...input.data.client };
  const doubts: OrScanDoubt[] = [];
  const pc = checkPlate(vehicle["plate"], { orNumber: input.orNumber ?? input.data.order["or_number"], account: client["account_number"] });
  if (pc === "or_number") {
    doubts.push({ field: "plate", code: "plate_or_number", message: `« ${String(vehicle["plate"])} » est le n° d'OR, pas une immatriculation.`, blocking: true });
    delete vehicle["plate"];
  } else if (pc === "atypical") {
    doubts.push({ field: "plate", code: "plate_atypical", message: `Immatriculation au format inhabituel : « ${String(vehicle["plate"])} ». Vérifiez-la.`, blocking: true });
  } else if (pc === "ok" && plateNearMiss(vehicle["plate"], input.localPlate)) {
    doubts.push({ field: "plate", code: "plate_two_readings", message: `Deux lectures diffèrent d'un caractère : ${formatPlate(String(vehicle["plate"]))} / ${formatPlate(String(input.localPlate))}.`, blocking: true });
  }
  if (isPollutedModel(vehicle["model"])) {
    doubts.push({ field: "model", code: "model_polluted", message: `Modèle illisible retiré (« ${String(vehicle["model"]).slice(0, 40)} »).`, blocking: false });
    delete vehicle["model"];
  }
  if (isGenericModel(vehicle["model"])) {
    doubts.push({ field: "model", code: "model_generic", message: `Modèle « ${String(vehicle["model"]).slice(0, 30)} » non reconnu (mot générique ou illisible) : retiré, à saisir.`, blocking: true });
    delete vehicle["model"];
  }
  const vinN = normalizeVin(vehicle["vin"]);
  if (vinN.candidate && !vinN.vin) {
    doubts.push({ field: "vin", code: "vin_invalid", message: `VIN « ${vinN.candidate} » : ${vinIssueMessage(vinN) ?? "format invalide"}. Vérifiez-le sur la carte grise.`, blocking: true });
  }
  const wmi = vinBrandConflict(vehicle["brand"], vehicle["vin"]);
  if (wmi) doubts.push({ field: "brand", code: "vin_brand", message: `Le VIN commence par un code ${wmi}, mais la marque lue est ${String(vehicle["brand"])}. Vérifiez VIN et marque.`, blocking: true });
  const exp = brandModelConflict(vehicle["brand"], vehicle["model"]);
  if (exp) doubts.push({ field: "brand", code: "brand_model", message: `${String(vehicle["model"])} est un modèle ${exp}, la marque lue est ${String(vehicle["brand"])}.`, blocking: true });
  // MEC : jamais la date de livraison / restitution / entrée lue sur l'OR.
  const g = guardFirstRegistration({ first_registration: vehicle["first_registration"], delivery_date: vehicle["delivery_date"], delivery_at: input.data.order["delivery_at"], entry_at: input.data.order["entry_at"], or_date: input.data.order["or_date"] });
  if (g.rejected) {
    doubts.push({
      field: "first_registration",
      code: g.rejected === "delivery" || g.rejected === "order_date" ? "mec_is_delivery" : "mec_invalid",
      message: g.rejected === "delivery" ? "La date lue comme 1re MEC est la date de livraison/restitution : MEC retirée, à vérifier (Ixellio ou saisie)."
        : g.rejected === "order_date" ? "La date lue comme 1re MEC est la date d'entrée/de l'OR : MEC retirée."
        : "1re MEC illisible ou future : retirée.",
      blocking: false,
    });
    vehicle["first_registration"] = null;
  } else if (g.first_registration) vehicle["first_registration"] = g.first_registration;
  const nameIssue = suspiciousName(client["last_name"], client["first_name"]);
  if (nameIssue) doubts.push({ field: "client", code: "client_suspicious", message: nameIssue, blocking: true });
  const addr = addressIssue(client);
  if (addr) doubts.push({ field: "client", code: "address_incoherent", message: `${addr} Vérifiez l'adresse.`, blocking: false });
  if (!String(client["last_name"] ?? "").trim()) {
    doubts.push({ field: "client", code: "client_missing", message: "Aucun client identifié : les coordonnées lues seront mises en attente de validation.", blocking: false });
  }
  return { data: { ...input.data, vehicle, client }, doubts };
}

/** Une confirmation est demandée seulement s'il y a au moins un doute. */
export const needsConfirmation = (doubts: OrScanDoubt[]) => doubts.length > 0;

/** Champs critiques comparés (journal, banc). */
export const OR_CRITICAL_FIELDS = ["order.or_number", "vehicle.plate", "vehicle.brand", "vehicle.model", "vehicle.mileage", "client.last_name", "client.first_name", "client.email", "client.phone", "client.mobile"] as const;

const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const norm = (path: string, v: unknown) => {
  const s = up(v);
  if (!s) return "";
  if (path === "vehicle.plate") return normalizePlate(s);
  if (path.endsWith("phone") || path.endsWith("mobile") || path === "vehicle.mileage" || path === "order.or_number") return digits(s);
  return s.replace(/[^A-Z0-9@.]/g, "");
};

/** Corrections opérateur : champs critiques modifiés entre lecture et confirmation (sans valeurs, pour les journaux). */
export function diffCritical(read: unknown, confirmed: unknown): string[] {
  return OR_CRITICAL_FIELDS.filter((p) => norm(p, at(read, p)) !== norm(p, at(confirmed, p)));
}

export type FieldScore = "exact" | "wrong" | "missing" | "extra" | "both_empty";
/** Score champ par champ d'une lecture contre une référence confirmée. */
export function scoreRead(reference: unknown, read: unknown): Record<string, FieldScore> {
  const out: Record<string, FieldScore> = {};
  for (const p of OR_CRITICAL_FIELDS) {
    const r = norm(p, at(reference, p)), v = norm(p, at(read, p));
    out[p] = !r && !v ? "both_empty" : !r ? "extra" : !v ? "missing" : r === v ? "exact" : "wrong";
  }
  return out;
}

export function summarizeScores(s: Record<string, FieldScore>): { exact: number; wrong: number; missing: number; extra: number; scored: number } {
  const v = Object.values(s);
  const c = (k: FieldScore) => v.filter((x) => x === k).length;
  return { exact: c("exact"), wrong: c("wrong"), missing: c("missing"), extra: c("extra"), scored: v.length - c("both_empty") };
}
