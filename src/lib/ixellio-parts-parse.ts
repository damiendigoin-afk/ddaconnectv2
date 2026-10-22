/**
 * Parseur pur des résultats « Recherche par référence » IXELLIO (PieceRecherche.html).
 *
 * Structure HTML réelle NON encore relevée : le parseur lit les tableaux à en-têtes
 * et rattache chaque colonne à un champ par son libellé. Rien n'est inféré :
 *  - prix HT/TTC seulement si l'en-tête le dit ; sinon basis = "unknown" ;
 *  - prix public seulement si l'en-tête dit « public » / « PVC » / « prix conseillé » ;
 *  - champ absent = null.
 * Chaque valeur porte sa provenance (libellé d'en-tête) et une confiance.
 */
import { decodeEntities, stripTags } from "./ixellio-parse";

export type Confidence = "header" | "none";
export type Sourced<T> = { value: T; source: string; confidence: Confidence } | null;
export type PriceBasis = "HT" | "TTC" | "unknown";

export type IxellioPartPrice = {
  amount: number;
  currency: string | null;
  basis: PriceBasis;
  isPublic: boolean | null;
  source: string;
};

export type IxellioPart = {
  reference: Sourced<string>;
  exactMatch: boolean;
  designations: { value: string; source: string }[];
  family: Sourced<string>;
  brand: Sourced<string>;
  prices: IxellioPartPrice[];
  /** Liens de fiche relatifs au domaine IXELLIO (chemin + method seulement). */
  detailLinks: string[];
  /** Colonnes non reconnues : libellé → valeur (pour enrichissement futur). */
  extra: Record<string, string>;
};

export type IxellioPartsResult = {
  isLoginPage: boolean;
  noResult: boolean;
  parts: IxellioPart[];
  /** Diagnostic non sensible : en-têtes de tableaux détectés. */
  headers: string[][];
  tableCount: number;
};

const norm = (s: string) =>
  stripTags(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

export const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Col = "reference" | "designation" | "family" | "brand" | "price" | null;

export function classifyHeader(h: string): Col {
  const n = norm(h);
  if (!n) return null;
  if (/(prix|tarif|montant|p\.?u\b|pvc|€)/.test(n)) return "price";
  if (/^(ref|reference|n ?° ?piece|numero|code piece|ref\.? (constructeur|oe|piece))/.test(n) || n === "ref.") return "reference";
  if (/(designation|libelle|description|denomination|nom)/.test(n)) return "designation";
  if (/(famille|categorie|groupe|sous-famille|rubrique)/.test(n)) return "family";
  if (/(marque|fabricant|equipementier|constructeur)/.test(n)) return "brand";
  return null;
}

export function priceBasisFromHeader(h: string): PriceBasis {
  const n = norm(h);
  if (/\bttc\b/.test(n)) return "TTC";
  if (/\bht\b/.test(n)) return "HT";
  return "unknown";
}

export function isPublicFromHeader(h: string): boolean | null {
  const n = norm(h);
  if (/(public|pvc|prix conseille|prix catalogue)/.test(n)) return true;
  if (/(net|remise|achat|pa\b)/.test(n)) return false;
  return null;
}

/** "119,25 €" → 119.25 ; "1 234,50" → 1234.5 ; sinon null. */
export function parseAmount(raw: string): { amount: number; currency: string | null } | null {
  const t = stripTags(raw).replace(/\u00a0/g, " ");
  const m = /(-?\d{1,3}(?:[ .]\d{3})*(?:,\d{1,4})|-?\d+(?:[.,]\d{1,4})?)/.exec(t);
  if (!m) return null;
  let s = m[1]!.replace(/ /g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const amount = Number(s);
  if (!Number.isFinite(amount)) return null;
  const currency = /€|eur\b/i.test(t) ? "EUR" : null;
  return { amount, currency };
}

function cells(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) out.push(m[2] ?? "");
  return out;
}

/** Ne garde qu'un chemin relatif IXELLIO + method (aucun autre paramètre, aucun hôte tiers). */
export function safeDetailLink(href: string): string | null {
  try {
    const u = new URL(decodeEntities(href), "https://www.ixellio.fr");
    if (u.hostname !== "www.ixellio.fr" || u.protocol !== "https:") return null;
    if (!/\.html$/i.test(u.pathname)) return null;
    const method = u.searchParams.get("method");
    return `${u.pathname}${method ? `?method=${method}` : ""}`;
  } catch {
    return null;
  }
}

export function parseIxellioParts(html: string, searched: string): IxellioPartsResult {
  const lower = html.toLowerCase();
  const isLoginPage = lower.includes("j_username") || lower.includes("j_spring_security_check");
  const target = normRef(searched);
  const parts: IxellioPart[] = [];
  const headers: string[][] = [];
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;
    const head = cells(rows[0]!).map((c) => stripTags(c));
    const kinds = head.map(classifyHeader);
    if (!kinds.includes("reference") && !kinds.includes("price")) continue;
    headers.push(head);

    for (const row of rows.slice(1)) {
      const cs = cells(row);
      if (cs.length < 2) continue;
      const part: IxellioPart = {
        reference: null,
        exactMatch: false,
        designations: [],
        family: null,
        brand: null,
        prices: [],
        detailLinks: [],
        extra: {},
      };
      cs.forEach((raw, i) => {
        const label = head[i] ?? `col${i + 1}`;
        const val = stripTags(raw);
        if (!val) return;
        switch (kinds[i]) {
          case "reference":
            part.reference ??= { value: val, source: label, confidence: "header" };
            break;
          case "designation":
            part.designations.push({ value: val, source: label });
            break;
          case "family":
            part.family ??= { value: val, source: label, confidence: "header" };
            break;
          case "brand":
            part.brand ??= { value: val, source: label, confidence: "header" };
            break;
          case "price": {
            const a = parseAmount(raw);
            if (a)
              part.prices.push({
                ...a,
                basis: priceBasisFromHeader(label),
                isPublic: isPublicFromHeader(label),
                source: label,
              });
            break;
          }
          default:
            if (val.length <= 120) part.extra[label] = val;
        }
      });
      const links = row.match(/href\s*=\s*["']([^"']+)["']/gi) ?? [];
      for (const l of links) {
        const href = /["']([^"']+)["']/.exec(l)?.[1];
        const safe = href ? safeDetailLink(href) : null;
        if (safe && !part.detailLinks.includes(safe)) part.detailLinks.push(safe);
      }
      if (!part.reference && !part.prices.length && !part.designations.length) continue;
      part.exactMatch = Boolean(part.reference && normRef(part.reference.value) === target);
      parts.push(part);
    }
  }

  const noResult =
    !isLoginPage && parts.length === 0 && /(aucun(e)? (resultat|piece|reference)|no result)/.test(norm(html));
  return { isLoginPage, noResult, parts, headers, tableCount: tables.length };
}
