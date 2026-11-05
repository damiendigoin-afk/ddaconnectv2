/**
 * Contrôles déterministes d'une lecture d'OR WinMotor (pure, testable, sans IA).
 * But : bloquer les valeurs impossibles et signaler les doutes, sans imposer de saisie
 * quand la lecture est cohérente. Rien n'est corrigé en silence.
 */
import { formatPlate, normalizePlate, wellFormedPlate } from "./plate";

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

export type OrScanDoubt = {
  field: "plate" | "brand" | "model" | "client";
  code: "plate_or_number" | "plate_atypical" | "plate_two_readings" | "model_polluted" | "brand_model" | "client_missing";
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
  const exp = brandModelConflict(vehicle["brand"], vehicle["model"]);
  if (exp) doubts.push({ field: "brand", code: "brand_model", message: `${String(vehicle["model"])} est un modèle ${exp}, la marque lue est ${String(vehicle["brand"])}.`, blocking: true });
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
