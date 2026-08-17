/** Mapping du fichier « SUIVI MISSIONS CARROSSERIE.xlsx » vers les dossiers DDA Connect. */
import { normalizePlate } from "@/lib/plate";

export type RawRow = Record<string, string>;

export type MissionMapped = {
  plate: string;
  /** Valeur brute exactement telle qu'elle figure dans le fichier. */
  plateSource: string;
  plateNormalized: string;
  vin: string;
  orNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vehicleLabel: string;
  missionDate: string | null;
  appointmentAt: string | null;
  entryAt: string | null;
  expectedReturnAt: string | null;
  caseState: string;
  physicalState: string;
  insurerName: string;
  agreementName: string;
  expertFirmName: string;
  expertName: string;
  claimNumber: string;
  missionNumber: string;
  payer: string;
  franchise: number | null;
  depreciation: number | null;
  amountTotalHt: number | null;
  amountTotalTtc: number | null;
  amountInsurerExpected: number | null;
  isVge: boolean;
  isHail: boolean;
  workLocation: string;
  subcontractor: string;
  comments: string;
  errors: string[];
  warnings: string[];
};

const SYNONYMS: Record<keyof typeof FIELDS, string[]> = {} as never;

const FIELDS = {
  plate: [
    "immatriculation",
    "immat",
    "immatriculations",
    "n immatriculation",
    "no immatriculation",
    "num immatriculation",
    "numero immatriculation",
    "n immat",
    "no immat",
    "num immat",
    "numero immat",
    "immat vehicule",
    "immatriculation vehicule",
    "plaque",
    "plaque immatriculation",
  ],
  vin: ["vin", "chassis", "n chassis", "numero de chassis"],
  orNumber: ["or", "n or", "num or", "numero or", "ordre de reparation", "of"],
  customerName: ["client", "nom client", "nom", "assure", "proprietaire", "raison sociale"],
  customerPhone: ["tel", "telephone", "portable", "mobile", "tel client"],
  customerEmail: ["email", "mail", "e mail", "courriel"],
  vehicleLabel: ["vehicule", "modele", "marque modele", "marque", "type vehicule"],
  missionDate: ["date mission", "date", "date reception mission", "date ouverture", "date sinistre"],
  appointmentAt: ["rdv", "date rdv", "rendez vous", "date de rdv"],
  entryAt: ["entree", "date entree", "entree atelier"],
  expectedReturnAt: ["sortie", "date sortie", "restitution", "date restitution", "livraison prevue"],
  caseState: ["statut", "etat", "etat dossier", "avancement", "situation"],
  physicalState: ["etat vehicule", "etat physique", "atelier"],
  insurerName: ["assurance", "assureur", "compagnie"],
  agreementName: ["agrement", "convention", "reseau"],
  expertFirmName: ["cabinet", "cabinet expertise", "cabinet d expertise"],
  expertName: ["expert", "nom expert"],
  claimNumber: ["sinistre", "n sinistre", "num sinistre", "numero de sinistre"],
  missionNumber: ["mission", "n mission", "num mission", "numero mission"],
  payer: ["payeur", "prise en charge", "qui paye"],
  franchise: ["franchise"],
  depreciation: ["vetuste", "vetuste deduite"],
  amountTotalHt: ["montant ht", "total ht", "ht"],
  amountTotalTtc: ["montant ttc", "total ttc", "ttc", "montant"],
  amountInsurerExpected: ["montant assurance", "reglement assurance", "attendu assurance"],
  isVge: ["vge", "ve", "vei"],
  isHail: ["grele"],
  workLocation: ["lieu", "lieu travaux", "site", "atelier travaux"],
  subcontractor: ["sous traitance", "sous traitant", "st"],
  comments: ["commentaire", "commentaires", "observation", "observations", "remarques", "note", "notes"],
} as const;

void SYNONYMS;

export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type HeaderIndex = Partial<Record<keyof typeof FIELDS, string>>;

/** Reconnaît une plaque FR (SIV « AB-123-CD » ou FNI « 1234 AB 56 »). */
export const PLATE_RE = /^[A-Z]{2}[\s.-]?\d{3}[\s.-]?[A-Z]{2}$|^\d{1,4}[\s.-]?[A-Z]{2,3}[\s.-]?\d{2,3}$/;

export function looksLikePlate(v: string): boolean {
  return PLATE_RE.test((v || "").toUpperCase().trim());
}

export type HeaderDiagnostic = {
  headers: string[];
  plateColumn: string | null;
  plateDetection: "entete" | "valeurs" | "aucune";
  samples: { row: number; source: string; trimmed: string; normalized: string }[];
};

export function buildHeaderIndex(headers: string[], sampleRows?: RawRow[]): HeaderIndex {
  const index: HeaderIndex = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    const candidates = FIELDS[key] as readonly string[];
    const hit =
      normalized.find((h) => candidates.includes(h.n)) ??
      normalized.find((h) => candidates.some((c) => h.n.startsWith(c))) ??
      normalized.find((h) => candidates.some((c) => h.n.includes(c)));
    if (hit) index[key] = hit.raw;
  }
  // Repli : aucune colonne d'en-tête reconnue → on cherche la colonne dont les valeurs sont des plaques.
  if (!index.plate && sampleRows?.length) {
    let best: { col: string; score: number } | null = null;
    for (const h of headers) {
      const score = sampleRows.slice(0, 40).filter((r) => looksLikePlate(String(r[h] ?? ""))).length;
      if (score > 0 && (!best || score > best.score)) best = { col: h, score };
    }
    if (best) index.plate = best.col;
  }
  return index;
}

/** Diagnostic d'import : colonnes reçues, colonne retenue et valeurs des 3 premières lignes. */
export function diagnoseHeaders(headers: string[], rows: RawRow[]): HeaderDiagnostic {
  const byHeader = buildHeaderIndex(headers);
  const withValues = buildHeaderIndex(headers, rows);
  const col = withValues.plate ?? null;
  return {
    headers,
    plateColumn: col,
    plateDetection: byHeader.plate ? "entete" : col ? "valeurs" : "aucune",
    samples: rows.slice(0, 3).map((r, i) => {
      const source = col ? String(r[col] ?? "") : "";
      const trimmed = source.trim();
      return { row: i + 2, source, trimmed, normalized: normalizePlate(trimmed) };
    }),
  };
}

function get(row: RawRow, index: HeaderIndex, key: keyof typeof FIELDS): string {
  const col = index[key];
  return col ? String(row[col] ?? "").trim() : "";
}

function toNumber(v: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Dates FR (jj/mm/aaaa), ISO ou série Excel. */
export function toDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (fr) {
    const [, d, m, y] = fr;
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    const iso = `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}$/.test(s)) {
    const ms = (Number(s) - 25569) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

const STATE_HINTS: [RegExp, string][] = [
  [/clos|termin[ée] et pay|solde/, "dossier_clos"],
  [/paiement|encaiss|reste (a|à) payer/, "attente_paiement"],
  [/restitu|livr/, "restitution"],
  [/travaux termin|fini/, "travaux_termines"],
  [/en cours|atelier/, "en_cours"],
  [/attente pi[eè]ce/, "attente_pieces"],
  [/compl[ée]ment/, "attente_complement"],
  [/rdv pr[ée]vu|rendez.?vous pr/, "rdv_prevu"],
  [/rdv/, "rdv_a_prendre"],
  [/pi[eè]ces command/, "pieces_commandees"],
  [/pi[eè]ces? (a|à) command/, "pieces_a_commander"],
  [/accord|valid/, "travaux_valides"],
  [/rapport/, "rapport_recu"],
  [/expert/, "attente_expert"],
  [/ead/, "ead_en_cours"],
  [/mission|nouveau|ouvert/, "mission_creee"],
];

export function mapCaseState(raw: string): string {
  const n = norm(raw);
  if (!n) return "mission_creee";
  for (const [re, key] of STATE_HINTS) if (re.test(n)) return key;
  return "mission_creee";
}

function truthy(v: string): boolean {
  const n = norm(v);
  return ["oui", "o", "x", "yes", "1", "true", "vge", "grele"].includes(n);
}

/** Corrections saisies à la main par l'utilisateur pour une ligne du fichier. */
export type MissionFix = {
  plate?: string;
  missionDate?: string;
  customerName?: string;
};

export function mapMissionRow(row: RawRow, index: HeaderIndex, fix?: MissionFix): MissionMapped {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1) correction manuelle 2) colonne détectée 3) repli : n'importe quelle cellule contenant une plaque.
  let plateRaw = (fix?.plate ?? "").trim() || get(row, index, "plate");
  if (!plateRaw) {
    const hit = Object.values(row).find((v) => looksLikePlate(String(v ?? "")));
    if (hit) plateRaw = String(hit).trim();
  }
  const plateNormalized = normalizePlate(plateRaw);
  if (!plateRaw) errors.push("Immatriculation absente (champ obligatoire).");
  else if (plateNormalized.length < 5) errors.push(`Immatriculation invalide : « ${plateRaw} ».`);

  const vin = get(row, index, "vin").toUpperCase().replace(/\s/g, "");
  if (vin && vin.length !== 17) warnings.push(`VIN incomplet (${vin.length} caractères au lieu de 17) : « ${vin} ».`);

  const missionDateRaw = (fix?.missionDate ?? "").trim() || get(row, index, "missionDate");
  const missionDate = toDate(missionDateRaw);
  if (missionDateRaw && !missionDate) errors.push(`Date de mission invalide : « ${missionDateRaw} ».`);

  const email = get(row, index, "customerEmail");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warnings.push(`E-mail incorrect : « ${email} ».`);

  const customerName = (fix?.customerName ?? "").trim() || get(row, index, "customerName");
  if (!customerName) warnings.push("Client non identifié dans le fichier.");

  for (const [key, label] of [
    ["appointmentAt", "RDV"],
    ["entryAt", "date d'entrée"],
    ["expectedReturnAt", "date de sortie"],
  ] as const) {
    const raw = get(row, index, key);
    if (raw && !toDate(raw)) warnings.push(`Date invalide pour ${label} : « ${raw} ».`);
  }

  const sub = get(row, index, "subcontractor");
  const lieu = get(row, index, "workLocation");
  const workLocation = sub ? "sous_traitance" : /st ?cyp/i.test(lieu) ? "st_cyp" : "site";

  return {
    plate: plateRaw.toUpperCase(),
    plateSource: plateRaw,
    plateNormalized,
    vin,
    orNumber: get(row, index, "orNumber"),
    customerName,
    customerPhone: get(row, index, "customerPhone"),
    customerEmail: email,
    vehicleLabel: get(row, index, "vehicleLabel"),
    missionDate,
    appointmentAt: toDate(get(row, index, "appointmentAt")),
    entryAt: toDate(get(row, index, "entryAt")),
    expectedReturnAt: toDate(get(row, index, "expectedReturnAt")),
    caseState: mapCaseState(get(row, index, "caseState")),
    physicalState: /restitu/i.test(get(row, index, "physicalState")) ? "restitue" : "pas_entre",
    insurerName: get(row, index, "insurerName"),
    agreementName: get(row, index, "agreementName"),
    expertFirmName: get(row, index, "expertFirmName"),
    expertName: get(row, index, "expertName"),
    claimNumber: get(row, index, "claimNumber"),
    missionNumber: get(row, index, "missionNumber"),
    payer: norm(get(row, index, "payer")).includes("client") ? "client" : get(row, index, "payer") ? "assurance" : "",
    franchise: toNumber(get(row, index, "franchise")),
    depreciation: toNumber(get(row, index, "depreciation")),
    amountTotalHt: toNumber(get(row, index, "amountTotalHt")),
    amountTotalTtc: toNumber(get(row, index, "amountTotalTtc")),
    amountInsurerExpected: toNumber(get(row, index, "amountInsurerExpected")),
    isVge: truthy(get(row, index, "isVge")),
    isHail: truthy(get(row, index, "isHail")),
    workLocation,
    subcontractor: sub,
    comments: get(row, index, "comments"),
    errors,
    warnings,
  };
}