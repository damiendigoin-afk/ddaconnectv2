/**
 * Parsing DÉTERMINISTE des mémentos forfaits Renault / Dacia à partir de la
 * couche texte du PDF (aucune IA, coût 0).
 *
 * Logique pure et testable : regroupement des fragments texte en lignes par
 * coordonnée Y, puis extraction par profil métier (code forfait, libellé,
 * temps, prix). Rien n'est déduit : une ligne non reconnue de façon fiable
 * n'est jamais importée, elle part dans « À contrôler ».
 */
import type { DetectedLine, PriceBasis, SourceKind } from "./packages-import";
import { sourceDef } from "./packages-import";

export type TextFragment = { str: string; x: number; y: number };
export type PageText = { page: number; fragments: TextFragment[] };

export type PageParse = {
  page: number;
  lines: DetectedLine[];
  /** Motifs de contrôle : page sans couche texte, tableau non reconnu… */
  uncertain: string[];
  /** true quand la page ne contient aucun texte exploitable (scan). */
  scanned: boolean;
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

export const PROFILES: Record<SourceKind, Profile> = {
  renault_public: {
    kind: "renault_public",
    brand: "Renault",
    basis: "ttc",
    codeRe: /^([A-Z]{2,6}[A-Z0-9]{1,6})\b/,
  },
  renault_pro_lld: {
    kind: "renault_pro_lld",
    brand: "Renault",
    basis: "ht",
    codeRe: /^([A-Z]{2,6}[A-Z0-9]{1,6})\b/,
  },
  dacia_public: {
    kind: "dacia_public",
    brand: "Dacia",
    basis: "ttc",
    codeRe: /^([A-Z]{2,6}[A-Z0-9]{1,6})\b/,
  },
};

const NUM_RE = /(?<![\w/])(\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})|\d+[.,]\d{1,2}|\d{1,4})(?!\d)/g;

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

const NOISE_RE = /^(sommaire|table des mati|page \d+|forfaits?$|tarifs?$)/i;

/**
 * Extrait les forfaits d'une page. Une ligne est retenue uniquement si elle
 * porte un code forfait ET un prix lisible ; sinon elle est signalée.
 */
export function parsePage(
  page: PageText,
  opts: {
    kind: SourceKind;
    fileName: string;
    version: string | null;
    model?: string | null;
  },
): PageParse {
  const profile = PROFILES[opts.kind] ?? PROFILES.renault_public;
  const basis = profile.basis ?? sourceDef(opts.kind).basis;
  const rows = groupLines(page.fragments);

  if (!rows.length) {
    return {
      page: page.page,
      lines: [],
      uncertain: [`page ${page.page} : aucune couche texte (page scannée) — à contrôler`],
      scanned: true,
    };
  }

  const lines: DetectedLine[] = [];
  const uncertain: string[] = [];
  const version = opts.version ?? detectVersion(rows);

  for (const row of rows) {
    if (NOISE_RE.test(row)) continue;
    const codeMatch = row.match(profile.codeRe);
    if (!codeMatch) continue;
    const code = codeMatch[1]!;
    const rest = row.slice(code.length).trim();
    const nums = [...rest.matchAll(NUM_RE)].map((m) => m[1]!);
    if (!nums.length) {
      uncertain.push(`page ${page.page} : « ${row.slice(0, 70)} » — aucun prix lisible`);
      continue;
    }

    const price = toNum(nums[nums.length - 1]!);
    const hoursRaw = nums.length >= 2 ? toNum(nums[0]!) : null;
    const hours = hoursRaw != null && hoursRaw > 0 && hoursRaw <= 50 ? hoursRaw : null;
    const label = rest
      .replace(NUM_RE, " ")
      .replace(/[€]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (price == null || price <= 0 || label.length < 3) {
      uncertain.push(`page ${page.page} : « ${row.slice(0, 70)} » — ligne incomplète`);
      continue;
    }

    lines.push({
      source_kind: opts.kind,
      source_file_name: opts.fileName,
      source_version: version,
      source_page: page.page,
      brand: profile.brand,
      model: opts.model ?? null,
      segment: null,
      energies: [],
      operation_code: code,
      label,
      price_value: price,
      price_basis: basis,
      hours,
      parts_ht: null,
      year_from: null,
      year_to: null,
      notes: null,
    });
  }

  if (!lines.length && !uncertain.length) {
    uncertain.push(`page ${page.page} : aucun forfait reconnu — à contrôler`);
  }
  return { page: page.page, lines, uncertain, scanned: false };
}

export type DocumentParse = {
  lines: DetectedLine[];
  uncertain: string[];
  scannedPages: number[];
  version: string | null;
  pagesParsed: number;
};

/** Parse toutes les pages d'un document déjà extrait en texte. */
export function parseDocument(
  pages: PageText[],
  opts: { kind: SourceKind; fileName: string; version: string | null },
): DocumentParse {
  const lines: DetectedLine[] = [];
  const uncertain: string[] = [];
  const scannedPages: number[] = [];
  let version = opts.version;

  for (const page of pages) {
    const out = parsePage(page, { ...opts, version });
    if (!version) version = out.lines[0]?.source_version ?? null;
    lines.push(...out.lines);
    uncertain.push(...out.uncertain);
    if (out.scanned) scannedPages.push(page.page);
  }

  return { lines, uncertain, scannedPages, version, pagesParsed: pages.length };
}
