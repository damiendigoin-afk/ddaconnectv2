/** État pneus (ex-« Étape pneu ») — structures et règles pures (lecture flanc, usure, profondeur IA expérimentale). */

export type Conf = "elevee" | "moyenne" | "faible" | null;

export type TireStepResult = {
  sidewall: {
    brand: string | null; model: string | null; size: string | null;
    width: number | null; height: number | null; diameter: number | null;
    load_index: string | null; speed_index: string | null;
    xl: boolean; runflat: boolean; three_pmsf: boolean; mud_snow: boolean;
    dot: string | null; dot_week: number | null; dot_year: number | null;
    homologations: string[]; other_markings: string[];
    read_quality: Conf;
  };
  wear: {
    pattern: "reguliere" | "irreguliere" | null;
    stronger_zone: "interieur" | "centre" | "exterieur" | "epaules" | null;
    facets: boolean; cracks: boolean; deformation: boolean;
    wear_indicator: "non_visible" | "visible" | "proche" | "atteint" | null;
    recommendation: string | null;
    observations: string[];
  };
  depth: {
    inner_mm: number | null; center_mm: number | null; outer_mm: number | null;
    points_mm: number[];
    gauge_visible: boolean;
    /** Côté de l'IMAGE correspondant à l'intérieur du véhicule, si déterminable de façon fiable. */
    inner_side: "gauche" | "droite" | null;
    confidence: Conf;
    note: string | null;
  };
};

export const TIRE_STEP_FEATURE = "tire_step";
export const TIRE_STEP_DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
/** Modèles proposés dans État pneus (tous présents dans BENCH_MODELS / passerelle). */
export const TIRE_STEP_MODELS = [
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (défaut, plus puissant)" },
] as const;
export function pickTireStepModel(requested: string | null | undefined): string {
  return TIRE_STEP_MODELS.some((m) => m.id === requested) ? requested! : TIRE_STEP_DEFAULT_MODEL;
}

export type Orientation = "auto" | "gauche" | "droite" | "inconnue";
/**
 * Libellés des zones gauche/milieu/droite de l'image. inner_mm = zone GAUCHE de l'image,
 * outer_mm = zone DROITE (convention image). Sans orientation fiable : Gauche/Milieu/Droite.
 */
export function zoneLabels(innerSide: "gauche" | "droite" | null): [string, string, string] {
  if (innerSide === "gauche") return ["Intérieur", "Milieu", "Extérieur"];
  if (innerSide === "droite") return ["Extérieur", "Milieu", "Intérieur"];
  return ["Gauche", "Milieu", "Droite"];
}
export function resolveInnerSide(o: Orientation, ai: "gauche" | "droite" | null): "gauche" | "droite" | null {
  if (o === "gauche" || o === "droite") return o;
  if (o === "inconnue") return null;
  return ai;
}
export const EXPERIMENTAL_DEPTH_NOTICE =
  "Estimation visuelle IA expérimentale — à confirmer par une mesure manuelle avant toute décision technique ou client.";
export const LEGAL_MIN_MM = 1.6;

const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);
const bool = (v: unknown) => v === true || v === "true";
const conf = (v: unknown): Conf => (v === "elevee" || v === "moyenne" || v === "faible" ? v : null);
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
const mm = (v: unknown) => { const n = num(v, 0, 15); return n === null ? null : Math.round(n * 10) / 10; };
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const oneOf = <T extends string>(v: unknown, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null);

/** "205/55 R16 91V" -> champs séparés. */
export function parseTireSize(s: string | null | undefined) {
  const m = (s ?? "").toUpperCase().match(/(\d{3})\s*\/\s*(\d{2})\s*Z?R?\s*F?\s*(\d{2}(?:[.,]5)?)\s*(?:(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z]))?/);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]), diameter: Number(m[3]!.replace(",", ".")), load: m[4] ?? null, speed: m[5] ?? null };
}

/** DOT "2321" -> semaine 23, année 2021. */
export function parseDot(dot: string | null) {
  const m = (dot ?? "").match(/(\d{2})(\d{2})\s*$/);
  if (!m) return { week: null, year: null };
  const week = Number(m[1]);
  return week >= 1 && week <= 53 ? { week, year: 2000 + Number(m[2]) } : { week: null, year: null };
}

export function normalizeTireStep(raw: Record<string, unknown> | null): TireStepResult {
  const sw = (raw?.["sidewall"] ?? {}) as Record<string, unknown>;
  const w = (raw?.["wear"] ?? {}) as Record<string, unknown>;
  const d = (raw?.["depth"] ?? {}) as Record<string, unknown>;
  const size = str(sw["size"]);
  const ps = parseTireSize(size);
  const dot = str(sw["dot"]);
  const pd = parseDot(dot);
  const inner = mm(d["inner_mm"]), center = mm(d["center_mm"]), outer = mm(d["outer_mm"]);
  const pts = (Array.isArray(d["points_mm"]) ? d["points_mm"].map(mm).filter((x): x is number => x !== null) : []);
  return {
    sidewall: {
      brand: str(sw["brand"]), model: str(sw["model"]), size,
      width: num(sw["width"], 100, 400) ?? ps?.width ?? null,
      height: num(sw["height"], 20, 95) ?? ps?.height ?? null,
      diameter: num(sw["diameter"], 10, 24) ?? ps?.diameter ?? null,
      load_index: str(sw["load_index"]) ?? ps?.load ?? null,
      speed_index: str(sw["speed_index"])?.toUpperCase() ?? ps?.speed ?? null,
      xl: bool(sw["xl"]), runflat: bool(sw["runflat"]), three_pmsf: bool(sw["three_pmsf"]), mud_snow: bool(sw["mud_snow"]),
      dot, dot_week: num(sw["dot_week"], 1, 53) ?? pd.week, dot_year: num(sw["dot_year"], 1990, 2100) ?? pd.year,
      homologations: list(sw["homologations"]), other_markings: list(sw["other_markings"]),
      read_quality: conf(sw["read_quality"]),
    },
    wear: {
      pattern: oneOf(w["pattern"], ["reguliere", "irreguliere"] as const),
      stronger_zone: oneOf(w["stronger_zone"], ["interieur", "centre", "exterieur", "epaules"] as const),
      facets: bool(w["facets"]), cracks: bool(w["cracks"]), deformation: bool(w["deformation"]),
      wear_indicator: oneOf(w["wear_indicator"], ["non_visible", "visible", "proche", "atteint"] as const),
      recommendation: str(w["recommendation"]),
      observations: list(w["observations"]),
    },
    depth: {
      inner_mm: inner, center_mm: center, outer_mm: outer,
      points_mm: pts.length >= 3 ? pts : [inner, center, outer].filter((x): x is number => x !== null),
      gauge_visible: bool(d["gauge_visible"]),
      inner_side: oneOf(d["inner_side"], ["gauche", "droite"] as const),
      confidence: conf(d["confidence"]),
      note: str(d["note"]),
    },
  };
}

export type WearLevel = "critique" | "surveiller" | "bon";
export function wearLevel(v: number | null): WearLevel | null {
  if (v === null) return null;
  if (v <= LEGAL_MIN_MM) return "critique";
  if (v < 3) return "surveiller";
  return "bon";
}

/** Écart gauche/droite (intérieur/extérieur) ≥ 1,5 mm => usure dissymétrique (suggère un contrôle géométrie). */
export function isAsymmetric(r: TireStepResult["depth"]) {
  if (r.inner_mm === null || r.outer_mm === null) return false;
  return Math.abs(r.inner_mm - r.outer_mm) >= 1.5;
}

/** Paramètres de recherche pour préremplir le devis pneu existant. */
export function quoteSearchFromResult(r: TireStepResult) {
  const s = r.sidewall;
  const out: Record<string, string> = {};
  if (s.width) out["w"] = String(s.width);
  if (s.height) out["h"] = String(s.height);
  if (s.diameter) out["d"] = String(s.diameter);
  if (s.load_index) out["li"] = s.load_index;
  if (s.speed_index) out["si"] = s.speed_index;
  if (s.brand) out["brand"] = s.brand;
  return out;
}

export const TIRE_STEP_PROMPT = `Tu es un technicien pneumatique français expérimenté. Tu reçois plusieurs photos d'UN SEUL pneu :
photos de la bande de roulement (usure) et photos du flanc (marquages). Les rôles sont indiqués avant chaque image.

FLANC : lis les marquages réellement visibles. N'invente jamais une marque, une dimension ou un indice : null si illisible.
BANDE DE ROULEMENT : décris l'usure (régulière/irrégulière, zone la plus usée vue de l'extérieur du véhicule si discernable,
facettes, craquelures, déformation, témoins d'usure).
PROFONDEUR (MODE EXPÉRIMENTAL DEMANDÉ PAR L'ATELIER) : donne ta meilleure ESTIMATION visuelle en mm de la profondeur
de sculpture, CONVENTION IMAGE : inner_mm = zone GAUCHE de l'image de bande de roulement, center_mm = milieu,
outer_mm = zone DROITE de l'image. inner_side = "gauche" ou "droite" UNIQUEMENT si tu peux déterminer de façon fiable quel
côté de l'image correspond à l'intérieur du véhicule, sinon null (ne devine jamais). Les images peuvent être des frames
successives d'une vidéo de balayage du même pneu : combine-les (un pneu neuf fait ~8 mm, témoin d'usure à 1,6 mm). Si une réglette
ou jauge est visible, indique gauge_visible=true et utilise-la comme référence. Si la bande de roulement n'est pas visible, null.
Indique une confiance honnête.

Réponds STRICTEMENT en JSON :
{"sidewall":{"brand":null,"model":null,"size":null,"width":null,"height":null,"diameter":null,"load_index":null,"speed_index":null,
"xl":false,"runflat":false,"three_pmsf":false,"mud_snow":false,"dot":null,"dot_week":null,"dot_year":null,
"homologations":[],"other_markings":[],"read_quality":"elevee|moyenne|faible"},
"wear":{"pattern":"reguliere|irreguliere|null","stronger_zone":"interieur|centre|exterieur|epaules|null","facets":false,"cracks":false,
"deformation":false,"wear_indicator":"non_visible|visible|proche|atteint|null","recommendation":null,"observations":[]},
"depth":{"inner_mm":null,"center_mm":null,"outer_mm":null,"points_mm":[],"gauge_visible":false,"inner_side":null,"confidence":"elevee|moyenne|faible","note":null}}
- size au format "205/55 R16 91V". homologations : ex "MO", "*", "AO", "N0", "E4 0212345".
- dot = 4 derniers chiffres (semaine+année). points_mm facultatif : 5 à 7 points de la gauche vers la droite de l'image.
- recommendation : prudente (ex "Contrôle de la géométrie conseillé"), jamais de kilométrage restant.`;

export const DEPTH_MIN_MM = 0;
export const DEPTH_MAX_MM = 12;
/** Pixels de glissement vertical par cran de 0,1 mm, et seuil avant d'engager l'ajustement. */
export const DRAG_PX_PER_STEP = 8;
export const DRAG_START_PX = 10;
/** Ajustement par geste : dy négatif (vers le haut) = +0,1 mm par cran ; borné 0–12 mm, arrondi au dixième. */
export function adjustDepth(start: number | null, dyPx: number): number {
  const steps = Math.trunc(-dyPx / DRAG_PX_PER_STEP);
  const v = Math.round(((start ?? 0) + steps * 0.1) * 10) / 10;
  return Math.min(DEPTH_MAX_MM, Math.max(DEPTH_MIN_MM, v));
}
