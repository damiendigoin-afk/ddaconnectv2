/**
 * Lecture déterministe du texte OCR d'un flanc de pneu (aucune IA).
 *
 * Photo 2 (roue complète) et photo 3 (gros plan dimension) sont lues
 * séparément puis consolidées au niveau ROUE. Aucune valeur n'est inventée :
 * un champ non lu reste null.
 */
import { TIRE_BRANDS } from "./tire-brands";

export type OcrSeason = "ete" | "quatre_saisons" | "hiver" | null;

export type TireOcrRead = {
  size: string | null; // "155/65R14"
  load: string | null; // "75"
  speed: string | null; // "T"
  xl: boolean;
  runflat: boolean;
  ms: boolean;
  pmsf: boolean;
  season: OcrSeason;
  seasonEvidence: string | null;
  brand: string | null;
  model: string | null;
  /** Lecture structurée complète : dimension + charge + vitesse. */
  complete: boolean;
  raw: string;
};

const SPEEDS = "LMNPQRSTUHVWYZ";

/** Corrige les confusions OCR courantes dans les zones numériques. */
function digitsFix(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

function norm(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\S\n]+/g, " ");
}

/** Dimension + indices : 155/65 R14 75T, 205/55R16 91V XL, 225/45ZR17 94W. */
export function parseSize(text: string): { size: string | null; load: string | null; speed: string | null } {
  const t = norm(text);
  const re = /([0-9OIl|SB]{3})\s*[/\\]\s*([0-9OIl|SB]{2})\s*(?:Z?R|ZR|R|-)\s*F?\s*([0-9OIl|SB]{2})(?:\s*C)?(?:\s+|\s*)([0-9OIl|]{2,3}(?:\/[0-9]{2,3})?)?\s*([A-Z])?(?![A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const w = Number(digitsFix(m[1]!));
    const s = Number(digitsFix(m[2]!));
    const r = Number(digitsFix(m[3]!));
    if (w < 115 || w > 355 || w % 5 !== 0 || s < 25 || s > 85 || s % 5 !== 0 || r < 12 || r > 24) continue;
    let load: string | null = m[4] ? digitsFix(m[4]).split("/")[0]! : null;
    let speed: string | null = m[5] && SPEEDS.includes(m[5]) ? m[5] : null;
    if (load && (Number(load) < 50 || Number(load) > 130)) load = null;
    if (!load) speed = null;
    return { size: `${w}/${s}R${r}`, load, speed };
  }
  // Indices isolés (ex. « 75T » lu seul) : utilisés seulement si une dimension manque ailleurs.
  return { size: null, load: null, speed: null };
}

/** Indices de charge/vitesse isolés (« 75T », « 91 V »), hors dimension. */
export function parseIndices(text: string): { load: string | null; speed: string | null } {
  const t = norm(text);
  const m = /(?:^|\s)([5-9][0-9]|1[0-2][0-9])\s?([LMNPQRSTUHVWY])(?=\s|$)/m.exec(t);
  return m ? { load: m[1]!, speed: m[2]! } : { load: null, speed: null };
}

const ALL_SEASON = [
  "ALL SEASON", "ALLSEASON", "ALL-SEASON", "4SEASONS", "4 SEASONS", "4-SEASONS", "4SEASON",
  "QUADRAXER", "CROSSCLIMATE", "ALL WEATHER", "ALLWEATHER", "QUATRAC", "KINERGY 4S", "4S2",
  "ALLSEASONCONTACT", "ALL SEASON CONTACT", "MULTISEASON", "MULTI SEASON", "WEATHERCONTROL",
];
const WINTER = ["WINTER", "SNOW", "ALPIN", "NORDIC", "ICE", "BLIZZAK", "SOTTOZERO", "WINGUARD", "KRISALP"];
const SUMMER = ["SUMMER", "ECOCONTACT", "PREMIUMCONTACT", "ENERGY SAVER", "PRIMACY", "EFFICIENTGRIP"];

export function parseSeason(text: string): { season: OcrSeason; evidence: string | null; ms: boolean; pmsf: boolean } {
  const t = norm(text);
  const ms = /\bM\s?[+&]\s?S\b|\bM\.S\b|\bMS\b(?=\s|$)/.test(t);
  const pmsf = /3\s?PMSF|\bPMSF\b|THREE PEAK/.test(t);
  const hit = (words: string[]) => words.find((w) => t.includes(w)) ?? null;
  const all = hit(ALL_SEASON);
  if (all) return { season: "quatre_saisons", evidence: all, ms, pmsf };
  const win = hit(WINTER);
  if (win) return { season: "hiver", evidence: win, ms, pmsf };
  const sum = hit(SUMMER);
  if (sum && !ms) return { season: "ete", evidence: sum, ms, pmsf };
  // M+S + 3PMSF sans mention hiver explicite : classement prudent 4 saisons.
  if (ms && pmsf) return { season: "quatre_saisons", evidence: "M+S + 3PMSF", ms, pmsf };
  return { season: null, evidence: null, ms, pmsf };
}

/** Marque connue par dictionnaire (mot entier, ≥ 4 lettres ou exacte). */
export function parseBrand(text: string, extra: string[] = []): string | null {
  const t = ` ${norm(text).replace(/[^A-Z0-9 ]/g, " ")} `;
  const list = [...new Set([...extra, ...TIRE_BRANDS])].sort((a, b) => b.length - a.length);
  for (const b of list) {
    const key = b.toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
    if (key.length < 4) continue;
    if (t.includes(` ${key} `)) return b;
  }
  return null;
}

/** Modèles fréquents par marque : uniquement des correspondances textuelles exactes. */
const MODELS: Record<string, string[]> = {
  Michelin: ["CROSSCLIMATE 2", "CROSSCLIMATE", "PRIMACY 4", "PRIMACY 3", "ENERGY SAVER", "ALPIN 6", "PILOT SPORT 4", "E PRIMACY"],
  Kleber: ["QUADRAXER 3", "QUADRAXER 2", "QUADRAXER", "DYNAXER HP4", "DYNAXER HP3", "KRISALP HP3"],
  Goodyear: ["VECTOR 4SEASONS G3", "VECTOR 4SEASONS G2", "VECTOR 4SEASONS", "EFFICIENTGRIP COMPACT 2", "EFFICIENTGRIP 2", "EFFICIENTGRIP", "ULTRAGRIP"],
  Continental: ["ALLSEASONCONTACT", "ECOCONTACT 6", "PREMIUMCONTACT 6", "WINTERCONTACT"],
  Hankook: ["KINERGY 4S2", "KINERGY 4S", "KINERGY ECO2", "KINERGY ECO", "VENTUS PRIME", "WINTER ICEPT"],
  Sailun: ["ATREZZO 4SEASONS", "ATREZZO ECO", "ATREZZO ELITE"],
  Cooper: ["WEATHERMASTER", "WINTER", "CS7", "ZEON"],
  Bridgestone: ["TURANZA", "BLIZZAK", "WEATHER CONTROL", "ECOPIA"],
  Pirelli: ["CINTURATO", "SOTTOZERO", "P ZERO"],
  Dunlop: ["SPORT ALL SEASON", "BLURESPONSE", "WINTER SPORT"],
  Uniroyal: ["ALLSEASONEXPERT", "RAINEXPERT"],
  Firestone: ["MULTISEASON", "ROADHAWK"],
  Falken: ["EUROALL SEASON", "ZIEX", "SINCERA"],
};

export function parseModel(text: string, brand: string | null): string | null {
  if (!brand) return null;
  const t = norm(text);
  const hit = (MODELS[brand] ?? []).find((m) => t.includes(m));
  if (!hit) return null;
  return hit.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/4seasons/i, "4Seasons");
}

export function parseTireText(text: string, extraBrands: string[] = []): TireOcrRead {
  const raw = text ?? "";
  const t = norm(raw);
  const size = parseSize(raw);
  const idx = size.size && !size.load ? parseIndices(raw) : { load: null, speed: null };
  const season = parseSeason(raw);
  const brand = parseBrand(raw, extraBrands);
  const load = size.load ?? idx.load;
  const speed = size.speed ?? idx.speed;
  return {
    size: size.size,
    load,
    speed,
    xl: /\bXL\b|EXTRA LOAD|REINFORCED/.test(t),
    runflat: /\bRFT\b|RUN ?FLAT|\bROF\b|\bSSR\b|\bZP\b/.test(t),
    ms: season.ms,
    pmsf: season.pmsf,
    season: season.season,
    seasonEvidence: season.evidence,
    brand,
    model: parseModel(raw, brand),
    complete: Boolean(size.size && load && speed),
    raw,
  };
}

/* ----------------------------- Consolidation ROUE ----------------------------- */

export type WheelOcrConfidence = "confirme" | "structure" | "partiel" | "conflit" | "aucune";

export type WheelOcr = {
  size: string | null;
  load: string | null;
  speed: string | null;
  brand: string | null;
  model: string | null;
  season: OcrSeason;
  xl: boolean;
  runflat: boolean;
  ms: boolean;
  pmsf: boolean;
  confidence: WheelOcrConfidence;
  conflicts: { field: string; values: string[] }[];
  provenance: Record<string, "photo2" | "photo3" | "photo2+photo3">;
  seasonEvidence: string | null;
};

type Field = "size" | "load" | "speed" | "brand" | "model" | "season";

/**
 * Photo 3 prime pour dimension/charge/vitesse si sa lecture est complète et
 * structurée ; sinon un désaccord reste un conflit à confirmer. Photo 2
 * complète marque/modèle/saison.
 */
export function consolidateWheelOcr(p2: TireOcrRead | null, p3: TireOcrRead | null): WheelOcr {
  const conflicts: WheelOcr["conflicts"] = [];
  const provenance: WheelOcr["provenance"] = {};
  const pick = (field: Field, critical: boolean): string | null => {
    const a = (p3?.[field] as string | null) ?? null;
    const b = (p2?.[field] as string | null) ?? null;
    if (a && b) {
      if (a === b) {
        provenance[field] = "photo2+photo3";
        return a;
      }
      if (critical && !p3?.complete) {
        conflicts.push({ field, values: [a, b] });
        return null;
      }
      provenance[field] = "photo3";
      return a;
    }
    const v = a ?? b;
    if (v) provenance[field] = a ? "photo3" : "photo2";
    return v;
  };
  const size = pick("size", true);
  const load = pick("load", true);
  const speed = pick("speed", true);
  const brand = pick("brand", false);
  const model = pick("model", false);
  const season = pick("season", false) as OcrSeason;
  const confirmed = Boolean(size && provenance["size"] === "photo2+photo3");
  const confidence: WheelOcrConfidence = conflicts.length
    ? "conflit"
    : confirmed && load && speed
      ? "confirme"
      : size && load && speed
        ? "structure"
        : size || load || brand || season
          ? "partiel"
          : "aucune";
  return {
    size,
    load,
    speed,
    brand,
    model,
    season,
    xl: Boolean(p2?.xl || p3?.xl),
    runflat: Boolean(p2?.runflat || p3?.runflat),
    ms: Boolean(p2?.ms || p3?.ms),
    pmsf: Boolean(p2?.pmsf || p3?.pmsf),
    confidence,
    conflicts,
    provenance,
    seasonEvidence: p3?.seasonEvidence ?? p2?.seasonEvidence ?? null,
  };
}

const SEASON_TXT: Record<string, string> = { ete: "Été", quatre_saisons: "4 saisons", hiver: "Hiver" };

/** « 155/65 R14 75T · Cooper · 4 saisons » — rien n'est affiché s'il n'est pas lu. */
export function wheelOcrSummary(w: WheelOcr): string {
  const size = w.size ? w.size.replace(/R(\d+)/, " R$1") : "";
  const ref = [size, `${w.load ?? ""}${w.speed ?? ""}`].filter(Boolean).join(" ");
  const parts = [ref, [w.brand, w.model].filter(Boolean).join(" "), w.season ? SEASON_TXT[w.season] : ""].filter(Boolean);
  if (w.conflicts.length) parts.push(`à confirmer (${w.conflicts.map((c) => c.values.join(" / ")).join(" ; ")})`);
  return parts.join(" · ");
}

/* ------------------------- Photo 1 : profondeur (jauge) ------------------------- */

export type DepthEstimate = { value: number; source: "jauge"; confidence: "moyenne" | "elevee"; evidence: string };

/**
 * Lit une jauge/réglette graduée sur la photo de bande : un nombre suivi de
 * « mm » (confiance élevée) ou un nombre isolé plausible près d'un mot de jauge
 * (confiance moyenne). Plage acceptée 0–12 mm. Jamais une mesure définitive.
 */
export function parseGaugeDepth(text: string): DepthEstimate | null {
  const t = norm(text ?? "").replace(/,/g, ".");
  const mm = /(?:^|[^0-9.])(\d{1,2}(?:\.\d)?)\s?MM\b/.exec(t);
  if (mm) {
    const v = Number(mm[1]);
    return v >= 0 && v <= 12 ? { value: v, source: "jauge", confidence: "elevee", evidence: mm[0].trim() } : null;
  }
  if (/JAUGE|GAUGE|TREAD|PROFIL|DEPTH/.test(t)) {
    const n = /(?:^|\s)(\d{1,2}(?:\.\d)?)(?=\s|$)/m.exec(t);
    const v = n ? Number(n[1]) : NaN;
    if (Number.isFinite(v) && v >= 0 && v <= 12) return { value: v, source: "jauge", confidence: "moyenne", evidence: n![0].trim() };
  }
  return null;
}

/** Seule une profondeur saisie/confirmée par le compagnon sert au jugement d'usure. */
export function depthForJudgement(manual: number | null | undefined, _estimate?: DepthEstimate | null): number | null {
  return manual != null && Number.isFinite(manual) ? manual : null;
}

/** Libellé profondeur : « 3 mm · confirmé », « ≈ 3 mm (estimé sur photo) — confirmer », ou « profondeur à confirmer ». */
export function depthLabel(manual: number | null | undefined, estimate: DepthEstimate | null | undefined): string {
  if (manual != null && Number.isFinite(manual)) return `${manual} mm · confirmé`;
  if (estimate) return `≈ ${estimate.value} mm (estimé sur photo) — confirmer`;
  return "profondeur à confirmer";
}

export type TireConfirmFields = {
  depth: number | null;
  size: string | null;
  load: string | null;
  speed: string | null;
  brand: string | null;
  model: string | null;
  season: OcrSeason;
  xl: boolean;
  runflat: boolean;
  ms: boolean;
  pmsf: boolean;
};

/** Confirmation humaine finale : verrouille les données comme « confirmed ». */
export function confirmTireFields(f: TireConfirmFields) {
  const clean = (v: string | null) => (v && v.trim() ? v.trim().toUpperCase() : null);
  const size = parseSize(f.size ?? "").size ?? clean(f.size);
  const load = clean(f.load);
  const speed = clean(f.speed);
  const depth = f.depth != null && Number.isFinite(f.depth) && f.depth >= 0 && f.depth <= 20 ? f.depth : null;
  return {
    ...f,
    size,
    load,
    speed,
    brand: f.brand?.trim() || null,
    model: f.model?.trim() || null,
    depth,
    depth_kind: depth != null ? ("mesure" as const) : null,
    confirmed: true as const,
    ref: size && load && speed ? `${size.replace(/R(\d+)/, " R$1")} ${load}${speed}` : null,
  };
}
