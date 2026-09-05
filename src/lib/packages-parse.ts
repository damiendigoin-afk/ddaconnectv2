/**
 * Parsing DÉTERMINISTE des mémentos forfaits Renault / Dacia à partir de la
 * couche texte du PDF (aucune IA, coût 0).
 *
 * Le mémento est un document à CONTEXTE : un titre de famille et un titre
 * d'opération s'appliquent à toutes les lignes qui suivent, y compris lorsque
 * le tableau se poursuit sur plusieurs pages, jusqu'au titre suivant. Le
 * contexte est donc transporté de page en page.
 *
 * Chaque ligne exploitable est décomposée en champs SÉPARÉS :
 * modèle / génération, motorisation, code forfait, prix. Rien n'est concaténé,
 * rien n'est déduit : une ligne non reconnue de façon fiable part en
 * « à contrôler ».
 */
import type { DetectedLine, PriceBasis, SourceKind } from "./packages-import";
import { sourceDef } from "./packages-import";

export type TextFragment = { str: string; x: number; y: number };
export type PageText = { page: number; fragments: TextFragment[] };

/** Contexte transporté d'une page à l'autre (titres de tableau en cours). */
export type ParseContext = {
  family: string | null;
  operation: string | null;
  model: string | null;
  generation: string | null;
  version: string | null;
};

export const emptyContext = (version: string | null = null): ParseContext => ({
  family: null,
  operation: null,
  model: null,
  generation: null,
  version,
});

export type PageParse = {
  page: number;
  lines: DetectedLine[];
  /** Motifs de contrôle : page sans couche texte, tableau non reconnu… */
  uncertain: string[];
  /** true quand la page ne contient aucun texte exploitable (scan). */
  scanned: boolean;
  /** Contexte à transmettre à la page suivante. */
  context: ParseContext;
};

/* ------------------------------- Regroupement ----------------------------- */

/** Regroupe les fragments par ligne (tolérance verticale) et les ordonne en X. */
export function groupLines(fragments: TextFragment[], tolerance = 2): string[] {
  const rows: { y: number; items: TextFragment[] }[] = [];
  for (const f of fragments) {
    if (!f.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - f.y) <= tolerance);
    if (row) row.items.push(f);
    else rows.push({ y: f.y, items: [f] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/* --------------------------------- Profils -------------------------------- */

export type Profile = {
  kind: SourceKind;
  brand: string;
  basis: PriceBasis;
  /** Code forfait : lettres majuscules + chiffres, 4 à 12 caractères. */
  codeRe: RegExp;
};

const CODE_TOKEN = /^[A-Z][A-Z0-9]{3,9}$/;

export const PROFILES: Record<SourceKind, Profile> = {
  renault_public: { kind: "renault_public", brand: "Renault", basis: "ttc", codeRe: CODE_TOKEN },
  renault_pro_lld: { kind: "renault_pro_lld", brand: "Renault", basis: "ht", codeRe: CODE_TOKEN },
  dacia_public: { kind: "dacia_public", brand: "Dacia", basis: "ttc", codeRe: CODE_TOKEN },
};

const NUM_RE = /(?<![\w/])(\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})|\d+[.,]\d{1,2}|\d{1,5})(?!\d)/g;

export function toNum(raw: string): number | null {
  const n = Number(raw.replace(/[ \u00a0]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Version / date du mémento imprimée sur la page (ex. « 01/2026 »). */
export function detectVersion(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(/\b(0[1-9]|1[0-2])[/.](20\d{2})\b/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

const NOISE_RE =
  /^(sommaire|table des mati|page \d+|forfaits?$|tarifs?$|prix ttc$|prix ht$|code$|main.?d.?oeuvre$)/i;

/** Motorisations telles qu'imprimées : « 1.3 16V », « 1.5 dCi », « E-TECH »… */
const ENGINE_RE =
  /\b(\d[.,]\d\s?(?:16V|8V|12V|dCi|DCI|TCe|TCE|SCe|SCE|Blue\s?dCi|CRZ|BVA)?|E-?TECH|ETECH|ELECTRIQUE|ÉLECTRIQUE|HYBRIDE|GPL)\b/i;

/** Génération / déclinaison de gamme : « CAPTUR II », « CLIO V », « PHASE 2 ». */
const GENERATION_RE = /\b(I|II|III|IV|V|VI|PHASE\s?\d)\b(?!\w)/;

/** Mots qui ne sont jamais un code forfait même s'ils en ont la forme. */
const CODE_STOPWORDS = new Set([
  "EUROPE",
  "FRANCE",
  "TOTAL",
  "PRIX",
  "FORFAIT",
  "FORFAITS",
  "MODELE",
  "MODÈLE",
  "MOTEUR",
  "GAMME",
  "PHASE",
  "TTC",
  "REMPLACEMENT",
  "DEPOSE",
  "REPOSE",
  "CONTROLE",
]);

export type RowParse = {
  code: string;
  model: string | null;
  generation: string | null;
  engine: string | null;
  description: string | null;
  price: number | null;
  hours: number | null;
};

/**
 * Décompose une ligne de tableau en champs séparés.
 * Retourne null si la ligne ne porte pas un couple code + prix fiable.
 */
export function parseRow(row: string): RowParse | null {
  const tokens = row.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  // Dernier nombre de la ligne = prix ; les nombres qui suivent le code sont
  // les valeurs chiffrées (temps éventuel puis prix).
  const numbers = [...row.matchAll(NUM_RE)].map((m) => m[1]!);
  if (!numbers.length) return null;

  let codeIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i]!.replace(/[.,;:]$/, "");
    if (!CODE_TOKEN.test(t)) continue;
    if (CODE_STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    codeIndex = i;
    break;
  }
  if (codeIndex < 0) return null;
  const code = tokens[codeIndex]!.replace(/[.,;:]$/, "");

  const before = tokens.slice(0, codeIndex).join(" ").trim();
  const after = tokens.slice(codeIndex + 1).join(" ").trim();

  const afterNums = [...after.matchAll(NUM_RE)].map((m) => m[1]!);
  if (!afterNums.length) return null;
  const price = toNum(afterNums[afterNums.length - 1]!);
  if (price == null || price <= 0) return null;
  const hoursRaw = afterNums.length >= 2 ? toNum(afterNums[0]!) : null;
  const hours = hoursRaw != null && hoursRaw > 0 && hoursRaw <= 50 ? hoursRaw : null;

  const engineMatch = before.match(ENGINE_RE);
  const engine = engineMatch ? engineMatch[0].replace(/\s+/g, " ").trim() : null;
  const modelRaw = (engineMatch ? before.slice(0, engineMatch.index ?? 0) : before)
    .replace(/[|·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const generationMatch = modelRaw.match(GENERATION_RE);
  const description = after.replace(NUM_RE, " ").replace(/[€]/g, " ").replace(/\s+/g, " ").trim();

  return {
    code,
    model: modelRaw || null,
    generation: generationMatch ? generationMatch[1]! : null,
    engine,
    description: description || null,
    price,
    hours,
  };
}

/** Une ligne sans code ni prix qui ressemble à un titre de tableau. */
function titleKind(row: string): "famille" | "operation" | null {
  const t = row.trim();
  if (t.length < 4 || t.length > 90) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return null;
  if (/\d{2,}[.,]\d{2}/.test(t)) return null;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letters) return null;
  const hasLower = /[a-zà-ÿ]/.test(letters);
  return hasLower ? "operation" : "famille";
}

/**
 * Extrait les forfaits d'une page en réutilisant le contexte des pages
 * précédentes (famille et libellé d'opération en cours).
 */
export function parsePage(
  page: PageText,
  opts: {
    kind: SourceKind;
    fileName: string;
    version: string | null;
    context?: ParseContext;
    model?: string | null;
  },
): PageParse {
  const profile = PROFILES[opts.kind] ?? PROFILES.renault_public;
  const def = sourceDef(opts.kind);
  const basis = profile.basis ?? def.basis;
  const rows = groupLines(page.fragments);
  const ctx: ParseContext = { ...(opts.context ?? emptyContext(opts.version)) };
  if (!ctx.version) ctx.version = opts.version;

  if (!rows.length) {
    return {
      page: page.page,
      lines: [],
      uncertain: [`page ${page.page} : aucune couche texte (page scannée) — à contrôler`],
      scanned: true,
      context: ctx,
    };
  }

  const lines: DetectedLine[] = [];
  const uncertain: string[] = [];
  if (!ctx.version) ctx.version = detectVersion(rows);

  for (const row of rows) {
    if (NOISE_RE.test(row)) continue;
    const parsed = parseRow(row);

    if (!parsed) {
      const kind = titleKind(row);
      if (kind === "famille") ctx.family = row.trim();
      else if (kind === "operation") ctx.operation = row.trim();
      else if (/\d/.test(row)) {
        uncertain.push(`page ${page.page} : « ${row.slice(0, 70)} » — ligne non exploitable`);
      }
      continue;
    }

    if (parsed.model) {
      ctx.model = parsed.model;
      ctx.generation = parsed.generation ?? ctx.generation;
    }
    const label = ctx.operation || parsed.description || parsed.code;
    if (!label) {
      uncertain.push(`page ${page.page} : forfait ${parsed.code} sans libellé d'opération`);
      continue;
    }

    lines.push({
      source_kind: opts.kind,
      source_file_name: opts.fileName,
      source_version: ctx.version,
      source_page: page.page,
      brand: profile.brand,
      model: parsed.model ?? ctx.model ?? opts.model ?? null,
      generation: parsed.generation ?? ctx.generation ?? null,
      engine: parsed.engine,
      family: ctx.family,
      operation_title: ctx.operation,
      description: parsed.description,
      zone: def.zone,
      tier: def.tier,
      segment: null,
      energies: [],
      operation_code: parsed.code,
      label,
      price_value: parsed.price,
      price_basis: basis,
      hours: parsed.hours,
      parts_ht: null,
      year_from: null,
      year_to: null,
      notes: null,
    });
  }

  if (!lines.length && !uncertain.length) {
    uncertain.push(`page ${page.page} : aucun forfait reconnu — à contrôler`);
  }
  return { page: page.page, lines, uncertain, scanned: false, context: ctx };
}

export type DocumentParse = {
  lines: DetectedLine[];
  uncertain: string[];
  scannedPages: number[];
  version: string | null;
  pagesParsed: number;
  context: ParseContext;
};

/** Parse une série de pages déjà extraites en texte, en gardant le contexte. */
export function parseDocument(
  pages: PageText[],
  opts: { kind: SourceKind; fileName: string; version: string | null; context?: ParseContext },
): DocumentParse {
  const lines: DetectedLine[] = [];
  const uncertain: string[] = [];
  const scannedPages: number[] = [];
  let ctx: ParseContext = opts.context ?? emptyContext(opts.version);

  for (const page of pages) {
    const out = parsePage(page, { ...opts, version: ctx.version, context: ctx });
    ctx = out.context;
    lines.push(...out.lines);
    uncertain.push(...out.uncertain);
    if (out.scanned) scannedPages.push(page.page);
  }

  return { lines, uncertain, scannedPages, version: ctx.version, pagesParsed: pages.length, context: ctx };
}
