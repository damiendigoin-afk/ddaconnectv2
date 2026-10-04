/**
 * Lecture déterministe d'une liste de pièces (rapport d'expertise, devis Ixellio/ETAI, devis carrosserie…).
 * Pure et testable : aucune IA, aucun accès base. L'émetteur du document est une INFORMATION,
 * jamais un fournisseur. Le prix lu est un prix source (tarif / prix de vente), jamais un PA.
 */
import { findFrenchPlate } from "./plate";

export type ProcurementItemType = "part" | "consumable" | "fee" | "service";
export type ProcurementSourceType = "expertise" | "ixellio" | "manual" | "other";

export type ParsedProcurementLine = {
  designation: string;
  reference: string | null;
  quantity: number;
  source_price_ht: number | null;
  source_operation: string | null;
  item_type: ProcurementItemType;
  original_text: string;
};

export type ParsedProcurementList = {
  source_type: ProcurementSourceType;
  source_label: string | null;
  plate: string | null;
  or_number: string | null;
  lines: ParsedProcurementLine[];
  warnings: string[];
};

const PART_OPS = new Set(["E", "O", "EP"]);
const ALL_OPS = new Set(["E", "O", "EP", "R", "D", "DP", "DR", "C", "P", "G", "T", "RP", "M", "EPP"]);

export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

const NUM_RE = /^-?\d+(?:[.,]\d+)?%?$/;
const UNIT_RE = /^(€|EUR|HT|TTC|H|X|U|UN)$/i;

/** Référence constructeur / équipementier : ≥ 5 chiffres, alphanumérique (tirets admis), jamais un prix. */
export function isRefToken(t: string): boolean {
  if (!/^[A-Z0-9][A-Z0-9-]{4,18}$/.test(t)) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  if (digits < 5) return false;
  if (/^\d+$/.test(t) && t.length < 7) return false;
  return true;
}

function toNumber(t: string): number | null {
  const v = Number(t.replace("%", "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Type d'une ligne d'après ses mots-clés (null = pas de mot-clé décisif). "operation" = travail atelier. */
export function keywordType(designation: string): ProcurementItemType | "operation" | null {
  const d = norm(designation);
  if (/^PORT\b|\bFRAIS DE PORT\b|^ERD\b|\bEMBALLAGE\b/.test(d)) return "fee";
  if (/\bPRET\b.*\bVDR\b|^PRET\b|\bVEHICULE DE REMPLACEMENT\b|^VDR\b/.test(d)) return "service";
  if (/\bAGRAFES?\b|\bRIVETS?\b|\bPLAQUE (DE )?POLICE\b|\bPLAQUE D.?IMMAT/.test(d)) return "consumable";
  if (/\bCONTROLE\b|\bCTRL\b|DEPOSE|REPOSE|\bDIAG|LECTURE DEFAUTS?|\bESSAI\b|CALIBRAGE|\bREGLAGE\b|\bPEINTURE\b|\bGEOMETRIE\b|\bFORF\.?\s*DIAG/.test(d)) return "operation";
  return null;
}

/** Classement d'une ligne : part / consumable / fee / service, ou null = opération atelier (exclue). */
export function classifyLine(designation: string, ops: string[], hasRef: boolean, inParts: boolean): ProcurementItemType | null {
  const kw = keywordType(designation);
  if (kw === "fee" || kw === "service" || kw === "consumable") return kw;
  if (kw === "operation") return null;
  if (ops.length) return ops.some((o) => PART_OPS.has(o)) ? "part" : null;
  return inParts && hasRef ? "part" : null;
}

const SECTION_START = /^(LISTE DES PIECES|PIECES\b|PIECES DETACHEES|FOURNITURES)/;
const SECTION_END = /^(MAIN[ -]D.?OEUVRE|TEMPS\b|PEINTURE\b|INGREDIENTS?\b|TOTAL\b|TOTAUX\b|RECAPITULATIF|MONTANT\b|OBSERVATIONS?\b)/;

function parseLine(raw: string, inParts: boolean): ParsedProcurementLine | { refOnly: string } | null {
  const tokens = norm(raw).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const rawTokens = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const ops: string[] = [];
  while (ops.length < 3 && tokens.length > 1 && ALL_OPS.has(tokens[0]!)) { ops.push(tokens.shift()!); rawTokens.shift(); }
  let ref: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (!ref && isRefToken(t)) {
      ref = t;
      const nx = tokens[i + 1];
      const nn = tokens[i + 2];
      if (nx && /^[A-Z0-9]{2,3}$/.test(nx) && !/^\d+$/.test(nx) && (/\d/.test(nx) || nn === undefined || NUM_RE.test(nn))) {
        ref = `${t} ${nx}`;
        i += 1;
      }
      continue;
    }
    rest.push(rawTokens[i] ?? t);
  }
  const words: string[] = [];
  const nums: string[] = [];
  for (const t of rest) {
    if (NUM_RE.test(t)) nums.push(t);
    else if (!UNIT_RE.test(t)) words.push(t);
  }
  const designation = words.join(" ").replace(/^[-–—:;,.\s]+|[-–—:;,\s]+$/g, "").trim();
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(designation)) return ref && !nums.length ? { refOnly: ref } : null;
  const type = classifyLine(designation, ops, !!ref, inParts);
  if (!type) return null;
  let quantity = 1;
  let price: number | null = null;
  const vals = nums.filter((n) => !n.endsWith("%"));
  let k = 0;
  if (vals[0] && /^\d{1,3}$/.test(vals[0]) && vals.length >= 2) { quantity = Number(vals[0]); k = 1; }
  else if (vals[0] && /^\d{1,3}[.,]0{1,2}$/.test(vals[0]) && vals.length >= 2) { quantity = toNumber(vals[0]) ?? 1; k = 1; }
  for (; k < vals.length; k += 1) {
    if (/[.,]\d{2}$/.test(vals[k]!)) { price = toNumber(vals[k]!); break; }
  }
  if (!(quantity > 0)) quantity = 1;
  return {
    designation,
    reference: ref,
    quantity,
    source_price_ht: price,
    source_operation: ops.length ? ops.join(" ") : null,
    item_type: type,
    original_text: raw.trim(),
  };
}

export function detectSourceType(text: string): ProcurementSourceType {
  const t = norm(text);
  if (/PROCES[- ]VERBAL D.EXPERTISE|RAPPORT D.EXPERTISE|\bEXPERTISE\b|\bEXPERTS?\b/.test(t)) return "expertise";
  if (/IXELLIO|\bETAI\b|\bDEVIS\b/.test(t)) return "ixellio";
  return "other";
}

export function detectIssuer(text: string, type: ProcurementSourceType): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (type === "ixellio") {
    for (const l of lines.slice(0, 20)) {
      const m = /\bDEVIS\s*(?:N[°O]\s*)?\d+\s+(.{3,80})$/i.exec(l);
      if (m) return m[1]!.trim();
    }
  }
  for (const l of lines.slice(0, 15)) {
    const n = norm(l);
    if (/PROCES[- ]VERBAL|RAPPORT D|LISTE DES|^DEVIS\b|IMMAT|^PAGE\b/.test(n)) continue;
    if (/\b(ROADIA|EXPERTS?|EXPAD|CABINET|BCA|EXPERTISE)\b/.test(n)) return l.replace(/\s{2,}.*$/, "").trim();
  }
  const first = lines.find((l) => /[A-Za-z]{3,}/.test(l) && !/PROC[EÈ]S|RAPPORT|^DEVIS/i.test(l));
  return first ? first.slice(0, 80) : null;
}

export function detectPlate(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/immat/i.test(lines[i]!)) {
      const p = findFrenchPlate(`${lines[i]} ${lines[i + 1] ?? ""}`.replace(/immat\w*/gi, " "));
      if (p) return p;
    }
  }
  return findFrenchPlate(text);
}

export function detectOrNumber(text: string): string | null {
  const m = /\b(?:N[°O]\s*)?(?:O\.R\.|OR|ORDRE DE R[EÉ]PARATION)\s*(?:N[°O])?\s*[:#]?\s*(\d{5,6})\b/i.exec(text);
  return m ? m[1]! : null;
}

/** Liste de pièces depuis le texte (natif PDF ou OCR). */
export function parseProcurementText(text: string): ParsedProcurementList {
  const source_type = detectSourceType(text);
  const lines: ParsedProcurementLine[] = [];
  let inParts = false;
  for (const raw of text.split(/\r?\n/)) {
    const n = norm(raw).trim();
    if (!n) continue;
    if (SECTION_START.test(n)) { inParts = true; continue; }
    if (SECTION_END.test(n)) { inParts = false; continue; }
    const r = parseLine(raw, inParts);
    if (!r) continue;
    if ("refOnly" in r) {
      // Référence repoussée seule sur la ligne suivante : rattachée à la dernière pièce sans réf.
      const last = lines[lines.length - 1];
      if (last && last.item_type === "part" && !last.reference) last.reference = r.refOnly;
      continue;
    }
    lines.push(r);
  }
  const warnings: string[] = [];
  if (!lines.some((l) => l.item_type === "part")) warnings.push("Aucune pièce de rechange reconnue automatiquement.");
  return { source_type, source_label: detectIssuer(text, source_type), plate: detectPlate(text), or_number: detectOrNumber(text), lines, warnings };
}

export const partCount = (p: { lines: { item_type: ProcurementItemType }[] }) => p.lines.filter((l) => l.item_type === "part").length;

/** IA de secours seulement si la lecture sans IA est vide ou incohérente. */
export function procurementNeedsAi(p: ParsedProcurementList, text: string | null | undefined): boolean {
  if ((text ?? "").replace(/\s/g, "").length < 40) return true;
  if (!partCount(p)) return true;
  // Pièce sans désignation lisible ou prix aberrant => colonnes décalées.
  return p.lines.some((l) => l.item_type === "part" && ((l.source_price_ht ?? 0) > 50000 || l.quantity > 99));
}

/** Normalise la réponse IA dans le même contrat (classement re-vérifié, opérations atelier exclues). */
export function fromAiJson(j: Record<string, unknown>, rules: ParsedProcurementList): ParsedProcurementList {
  const arr = Array.isArray(j["lines"]) ? (j["lines"] as Record<string, unknown>[]) : [];
  const lines: ParsedProcurementLine[] = [];
  for (const x of arr) {
    const designation = String(x["designation"] ?? x["label"] ?? "").trim();
    if (!designation) continue;
    const ref = typeof x["reference"] === "string" && x["reference"].trim() ? x["reference"].trim().toUpperCase() : null;
    const op = typeof x["source_operation"] === "string" ? norm(x["source_operation"]).trim() : "";
    const ops = op ? op.split(/\s+/).filter((o) => ALL_OPS.has(o)) : [];
    const aiType = String(x["item_type"] ?? "");
    let type = classifyLine(designation, ops, !!ref, true);
    if (type === "part" && ["consumable", "fee", "service"].includes(aiType)) type = aiType as ProcurementItemType;
    if (!type) continue;
    const q = Number(x["quantity"]);
    const p = x["source_price_ht"] == null ? null : Number(String(x["source_price_ht"]).replace(",", "."));
    lines.push({ designation, reference: ref, quantity: q > 0 ? q : 1, source_price_ht: p != null && Number.isFinite(p) ? p : null, source_operation: ops.join(" ") || null, item_type: type, original_text: designation });
  }
  const st = String(j["source_type"] ?? "");
  return {
    source_type: rules.source_type !== "other" ? rules.source_type : (["expertise", "ixellio"].includes(st) ? (st as ProcurementSourceType) : "other"),
    source_label: rules.source_label ?? (typeof j["source_label"] === "string" ? j["source_label"] : null),
    plate: rules.plate ?? (typeof j["plate"] === "string" ? findFrenchPlate(j["plate"]) : null),
    or_number: rules.or_number ?? (typeof j["or_number"] === "string" && /^\d{5,6}$/.test(j["or_number"]) ? j["or_number"] : null),
    lines,
    warnings: lines.some((l) => l.item_type === "part") ? [] : ["Aucune pièce de rechange reconnue : ajoutez les lignes à la main."],
  };
}
