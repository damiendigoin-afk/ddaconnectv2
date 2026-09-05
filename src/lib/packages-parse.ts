/**
 * Parsing DÉTERMINISTE des mémentos forfaits Renault / Dacia à partir de la
 * couche texte du PDF (aucune IA, coût 0).
 *
 * Le mémento est un document à CONTEXTE : un titre de famille et un titre
 * d'opération s'appliquent à toutes les lignes qui suivent, y compris lorsque
 * le tableau se poursuit sur plusieurs pages, jusqu'au titre suivant. Le
 * contexte est donc transporté de page en page.
 *
 * Deux modes de lecture d'un tableau :
 *  - COLONNES (prioritaire) : les bornes X sont déduites de la ligne d'en-tête
 *    (« véhicule motorisation code tarif »), chaque cellule est accumulée
 *    séparément, y compris sur plusieurs lignes, jusqu'au couple code + tarif.
 *  - JETONS (repli) : lorsque la couche texte ne permet pas de colonnes.
 *
 * Rien n'est concaténé entre deux lignes voisines, rien n'est déduit : une
 * ligne non reconnue de façon fiable part en « à contrôler ».
 */
import type { DetectedLine, PriceBasis, SourceKind } from "./packages-import";
import { sourceDef } from "./packages-import";
import { isForbiddenLabel } from "./packages-guard";


export type TextFragment = { str: string; x: number; y: number };
export type PageText = { page: number; fragments: TextFragment[] };

/**
 * Schéma du tableau en cours, déduit de sa ligne d'en-tête.
 * `hasVehicle` : il existe une vraie colonne véhicule / modèle / gamme.
 * `hasLabel`   : la colonne de gauche est un libellé de forfait (révisions…).
 */
export type TableSchema = {
  hasVehicle: boolean;
  hasLabel: boolean;
  header: string;
};

export type ColumnName = "vehicle" | "engine" | "label" | "code" | "price" | "other";
export type Column = { name: ColumnName; x: number };
/** Cellules en cours d'accumulation (tableau à cellules multi-lignes). */
export type PendingCells = Partial<Record<ColumnName, string>>;

/** Contexte transporté d'une page à l'autre (titres de tableau en cours). */
export type ParseContext = {
  family: string | null;
  operation: string | null;
  /**
   * Contenu du forfait : le texte qui suit « ce forfait comprend : », valable
   * pour toutes les lignes de la section, y compris sur plusieurs pages,
   * jusqu'au prochain forfait / prochaine rubrique.
   */
  description: string | null;
  /** true tant que les lignes lues alimentent le contenu du forfait. */
  capturingDescription: boolean;
  model: string | null;
  generation: string | null;
  version: string | null;
  table: TableSchema | null;
  columns: Column[] | null;
  pending: PendingCells | null;
};

export const emptyContext = (version: string | null = null): ParseContext => ({
  family: null,
  operation: null,
  description: null,
  capturingDescription: false,
  model: null,
  generation: null,
  version,
  table: null,
  columns: null,
  pending: null,
});

/** « ce forfait comprend », « ces forfaits comprennent : », ponctuation tolérée. */
export function isComprendMarker(row: string): boolean {
  return /^ces? +forfaits? +(comprend|comprennent)\s*[:.\-–]?\s*$/.test(norm(row));
}



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

export type Row = { y: number; items: TextFragment[]; text: string };

/** Regroupe les fragments par ligne (tolérance verticale) et les ordonne en X. */
export function groupRows(fragments: TextFragment[], tolerance = 2): Row[] {
  const rows: { y: number; items: TextFragment[] }[] = [];
  for (const f of fragments) {
    if (!f.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - f.y) <= tolerance);
    if (row) row.items.push(f);
    else rows.push({ y: f.y, items: [f] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const items = r.items.sort((a, b) => a.x - b.x);
      return {
        y: r.y,
        items,
        text: items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((r) => r.text.length > 0);
}

export function groupLines(fragments: TextFragment[], tolerance = 2): string[] {
  return groupRows(fragments, tolerance).map((r) => r.text);
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

/**
 * Numéro de page IMPRIMÉ sur la page (« 248/249 », « page 248/249 »).
 * Le PDF peut contenir des pages techniques : l'index pdfjs n'est alors pas le
 * numéro que l'utilisateur lit sur le document.
 */
export function detectPrintedPage(lines: string[]): { page: number; total: number } | null {
  for (const l of lines) {
    const t = l.trim();
    if (t.length > 40) continue;
    const m = t.match(/(?:^|\s)(?:page\s*)?(\d{1,3})\s*\/\s*(\d{2,4})(?:\s|$)/i);
    if (!m) continue;
    const page = Number(m[1]);
    const total = Number(m[2]);
    if (page >= 1 && total >= page && total <= 2000) return { page, total };
  }
  return null;
}

const NOISE_RE =
  /^(sommaire|table des mati|page \d+|forfaits?$|tarifs?$|prix ttc$|prix ht$|code$|main.?d.?oeuvre$)/i;

/** Motorisations telles qu'imprimées : « 1.3 16V », « 1.5 dCi », « E-TECH »… */
const ENGINE_RE =
  /\b(\d[.,]\d\s?(?:16V|8V|12V|dCi|DCI|TCe|TCE|SCe|SCE|Blue\s?dCi|CRZ|BVA)?|Z\.?E\.?|E-?TECH|ETECH|ELECTRIQUE|ÉLECTRIQUE|HYBRIDE|GPL)\b/i;

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
  /** Libellé porté par la ligne elle-même (tableaux « libellé … code tarif »). */
  rowLabel: string | null;
  description: string | null;
  price: number | null;
  hours: number | null;
};

/** Comparaison insensible aux accents / à la casse. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const VEHICLE_HEADERS = ["vehicule", "vehicules", "modele", "gamme", "version vehicule"];
const LABEL_HEADERS = ["libelle", "designation", "intitule", "operation", "prestation"];

/**
 * Reconnaît la ligne d'en-tête d'un tableau et en déduit le schéma de colonnes.
 * Sans colonne véhicule reconnue, aucun modèle ne sera jamais inventé.
 */
export function detectTableSchema(row: string): TableSchema | null {
  const n = norm(row);
  if (n.length > 90) return null;
  const hasCode = /\bcode\b/.test(n);
  const hasPrice = /\b(tarif|tarifs|prix|prix ttc|prix ht|montant)\b/.test(n);
  if (!hasCode || !hasPrice) return null;
  if (/\d{2,}/.test(n)) return null; // une vraie ligne de données, pas un en-tête
  const hasVehicle = VEHICLE_HEADERS.some((h) => n.includes(h));
  const hasLabel = LABEL_HEADERS.some((h) => n.includes(h)) || /\b(norme|huile)\b/.test(n);
  return { hasVehicle, hasLabel: hasLabel && !hasVehicle, header: row.trim() };
}

/** Bornes X des colonnes déduites des mots de l'en-tête. */
export function detectColumns(items: TextFragment[]): Column[] | null {
  const cols: Column[] = [];
  for (const it of items) {
    for (const word of it.str.split(/\s+/).filter(Boolean)) {
      const n = norm(word);
      let name: ColumnName | null = null;
      if (VEHICLE_HEADERS.includes(n)) name = "vehicle";
      else if (/^motorisations?$|^moteurs?$|^energies?$/.test(n)) name = "engine";
      else if (LABEL_HEADERS.includes(n) || /^(norme|huile)$/.test(n)) name = "label";
      else if (n === "code") name = "code";
      else if (/^(tarif|tarifs|prix|montant)$/.test(n)) name = "price";
      if (!name) continue;
      if (cols.some((c) => c.name === name)) continue;
      cols.push({ name, x: it.x });
    }
  }
  if (!cols.some((c) => c.name === "code") || !cols.some((c) => c.name === "price")) return null;
  const sorted = cols.sort((a, b) => a.x - b.x);
  // Colonnes indiscernables (tous les mots au même X) : pas de mode colonnes.
  const distinct = new Set(sorted.map((c) => Math.round(c.x)));
  if (distinct.size < sorted.length) return null;
  return sorted;
}

function columnOf(columns: Column[], x: number): ColumnName {
  let name: ColumnName = columns[0]?.name ?? "other";
  for (const c of columns) {
    if (x + 3 >= c.x) name = c.name;
    else break;
  }
  return name;
}

/** Une ligne de données répartie sur les colonnes du tableau. */
export function cellsFromRow(columns: Column[], items: TextFragment[]): PendingCells {
  const cells: PendingCells = {};
  for (const it of items) {
    const str = it.str.trim();
    if (!str) continue;
    const name = columnOf(columns, it.x);
    cells[name] = cells[name] ? `${cells[name]} ${str}` : str;
  }
  return cells;
}

function mergeCells(base: PendingCells, next: PendingCells): PendingCells {
  const out: PendingCells = { ...base };
  for (const [k, v] of Object.entries(next) as [ColumnName, string][]) {
    out[k] = out[k] ? `${out[k]} ${v}` : v;
  }
  return out;
}

const cleanCell = (v: string | undefined | null): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").replace(/^[,;·|]+|[,;·|]+$/g, "").trim();
  return t || null;
};

/**
 * Génération : renseignée uniquement lorsqu'elle est NON AMBIGUË, c'est-à-dire
 * quand la cellule véhicule ne contient qu'un seul modèle. Sur
 * « AUSTRAL / ESPACE VI / RAFALE », « VI » ne concerne qu'ESPACE.
 */
export function generationOf(model: string | null): string | null {
  if (!model) return null;
  if (/[/,]/.test(model)) return null;
  const m = model.match(GENERATION_RE);
  return m ? m[1]! : null;
}

/**
 * Décompose une ligne de tableau en champs séparés (mode JETONS).
 * Retourne null si la ligne ne porte pas un couple code + prix fiable.
 */
export function parseRow(row: string, schema?: TableSchema | null): RowParse | null {
  const tokens = row.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

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
  const description = after.replace(NUM_RE, " ").replace(/[€]/g, " ").replace(/\s+/g, " ").trim();

  // Tableau sans colonne véhicule : le texte de gauche est un libellé de forfait.
  const vehicleColumn = schema ? schema.hasVehicle : true;
  if (!vehicleColumn) {
    return {
      code,
      model: null,
      generation: null,
      engine: null,
      rowLabel: cleanCell(before),
      description: description || null,
      price,
      hours,
    };
  }

  const engineMatch = before.match(ENGINE_RE);
  // La motorisation est TOUTE la fin de cellule à partir du premier motif
  // moteur (« 1.2, 1.2 12V »), jamais seulement le premier motif.
  const engine = engineMatch ? cleanCell(before.slice(engineMatch.index ?? 0)) : null;
  const modelRaw = cleanCell(
    (engineMatch ? before.slice(0, engineMatch.index ?? 0) : before).replace(/[|·]/g, " "),
  );

  return {
    code,
    model: modelRaw,
    generation: generationOf(modelRaw),
    engine,
    rowLabel: null,
    description: description || null,
    price,
    hours,
  };
}

/** Débuts de phrase descriptive : jamais un titre de rubrique. */
const SENTENCE_START =
  /^(la |le |les |l'|un |une |des |du |de |ce |cet |cette |ces |il |elle |nous |vous |y |dont |avec |sans |sous |pour |selon |soit |hors |voir |dans |en cas|nb |remarque)/;

/** Lignes de contenu / pied de page à ne jamais promouvoir en titre. */
const NEVER_TITLE =
  /(comprend|compris|prix indicat|tarif conseill|main.?d.?(?:oe|œ)uvre incluse|hors |page \d|zone \d|^zone\b|^tarifs?\b|^prix\b|^sommaire|^v[ée]hicule\b|^edition|^mise ?à ?jour|^valable|^©)/;

/**
 * Une ligne sans code ni prix qui ressemble à un titre de rubrique.
 * Volontairement restrictif : une phrase descriptive, une ligne de contenu
 * (« ce forfait comprend : ») ou un en-tête de tableau n'en est jamais un.
 */
export function titleKind(row: string): "famille" | "operation" | null {
  const t = row.trim();
  if (t.length < 4 || t.length > 70) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return null;
  if (detectTableSchema(t)) return null;
  if (isForbiddenTitle(t)) return null;
  if (/[:;,•]/.test(t)) return null; // ponctuation de contenu
  if (/\.\s*$/.test(t)) return null; // phrase terminée
  if (/\d{2,}/.test(t)) return null;
  const n = norm(t);
  if (SENTENCE_START.test(n)) return null;
  if (NEVER_TITLE.test(n)) return null;
  const words = n.split(" ").filter(Boolean);
  if (words.length > 9) return null;

  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letters) return null;
  const hasLower = /[a-zà-ÿ]/.test(letters);
  const familyWord =
    /^(forfaits?|entretien|revision|revisions|pneumatiques?|carrosserie|climatisation|freinage|distribution|vidange|diagnostic|accessoires?)\b/.test(
      n,
    );
  if (!hasLower) return "famille";
  return familyWord && words.length <= 3 ? "famille" : "operation";
}

/**
 * GARDE-FOU : textes qui ne doivent JAMAIS être enregistrés comme libellé,
 * titre d'opération ou famille, même si le parseur se trompe.
 */
export function isForbiddenTitle(value: string | null | undefined): boolean {
  return isForbiddenLabel(value);
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
    /** Nombre de pages du PDF : invariant de source_page. */
    pageCount?: number;
  },
): PageParse {
  const profile = PROFILES[opts.kind] ?? PROFILES.renault_public;
  const def = sourceDef(opts.kind);
  const basis = profile.basis ?? def.basis;
  const rows = groupRows(page.fragments);
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
  const texts = rows.map((r) => r.text);
  if (!ctx.version) ctx.version = detectVersion(texts);

  // Numéro de page : IMPRIMÉ si le document en porte un, sinon index pdfjs.
  const printed = detectPrintedPage(texts);
  const maxPage = printed?.total ?? opts.pageCount ?? null;
  let sourcePage: number | null = printed?.page ?? page.page;
  if (sourcePage != null && (sourcePage < 1 || (maxPage != null && sourcePage > maxPage))) {
    uncertain.push(
      `page ${page.page} : numéro de page source hors document (${sourcePage} > ${maxPage}) — non enregistré`,
    );
    sourcePage = null;
  }

  let pending: PendingCells = ctx.pending ?? {};

  const push = (p: {
    code: string;
    model: string | null;
    generation: string | null;
    engine: string | null;
    rowLabel: string | null;
    description: string | null;
    price: number | null;
    hours: number | null;
  }) => {
    const vehicleTable = ctx.table ? ctx.table.hasVehicle : true;
    if (vehicleTable && p.model) {
      ctx.model = p.model;
      ctx.generation = p.generation ?? null;
    }
    const candidates = [p.rowLabel, ctx.operation, p.description, p.code];
    const label = candidates.find((c) => c && !isForbiddenTitle(c)) ?? null;
    if (!label) {
      uncertain.push(`page ${sourcePage ?? page.page} : forfait ${p.code} sans libellé exploitable — à contrôler`);
      return;
    }
    if (sourcePage == null) {
      uncertain.push(`page ${page.page} : forfait ${p.code} sans page source fiable — à contrôler`);
      return;
    }
    const operationTitle = ctx.operation && !isForbiddenTitle(ctx.operation) ? ctx.operation : null;
    const family = ctx.family && !isForbiddenTitle(ctx.family) ? ctx.family : null;

    lines.push({
      source_kind: opts.kind,
      source_file_name: opts.fileName,
      source_version: ctx.version,
      source_page: sourcePage,
      brand: profile.brand,
      model: vehicleTable ? (p.model ?? ctx.model ?? opts.model ?? null) : null,
      generation: vehicleTable ? (p.generation ?? null) : null,
      engine: p.engine,
      family,
      operation_title: operationTitle,
      // Le descriptif est le contenu de la SECTION (« ce forfait comprend : »),
      // jamais le texte résiduel d'une ligne de tableau.
      description: ctx.description && !isForbiddenLabel(ctx.description) ? ctx.description : null,

      zone: def.zone,
      tier: def.tier,
      segment: null,
      energies: [],
      operation_code: p.code,
      label,
      price_value: p.price,
      price_basis: basis,
      hours: p.hours,
      parts_ht: null,
      year_from: null,
      year_to: null,
      notes: null,
    });
  };

  /** Ajoute une ligne au contenu du forfait en cours. */
  const addDescription = (text: string) => {
    const t = text.trim();
    if (!t || isForbiddenTitle(t) || isForbiddenLabel(t)) return;
    const next = ctx.description ? `${ctx.description} ${t}` : t;
    ctx.description = next.replace(/\s+/g, " ").slice(0, 600);
  };

  for (const row of rows) {
    const text = row.text;
    if (NOISE_RE.test(text)) continue;

    // « ce forfait comprend : » ouvre le contenu du forfait courant.
    if (isComprendMarker(text)) {
      ctx.capturingDescription = true;
      ctx.description = null;
      continue;
    }

    // Une ligne d'en-tête fixe le schéma du tableau (et ses colonnes) pour
    // toutes les lignes qui suivent, y compris sur les pages suivantes.
    const schema = detectTableSchema(text);
    if (schema) {
      ctx.capturingDescription = false;
      ctx.table = schema;
      ctx.columns = detectColumns(row.items);
      pending = {};
      if (!schema.hasVehicle) {
        ctx.model = null;
        ctx.generation = null;
      }
      continue;
    }

    // Lignes de contenu : accumulées jusqu'au tableau ou au prochain titre.
    if (ctx.capturingDescription) {
      if (titleKind(text) == null && !/\b\d{2,}\b/.test(text)) {
        addDescription(text);
        continue;
      }
      ctx.capturingDescription = false;
    }


    /* ------------------------------ Mode colonnes ------------------------- */
    if (ctx.columns) {
      const cells = cellsFromRow(ctx.columns, row.items);
      const isTitleRow =
        !cells.code &&
        !cells.price &&
        !Object.keys(pending).length &&
        titleKind(text) != null;
      if (isTitleRow) {
        const kind = titleKind(text);
        if (kind === "famille") ctx.family = text.trim();
        else ctx.operation = text.trim();
        // Nouveau forfait / nouvelle rubrique : le contenu précédent ne
        // s'applique plus.
        ctx.description = null;
        ctx.capturingDescription = false;

        continue;
      }
      pending = mergeCells(pending, cells);
      const codeCell = cleanCell(pending.code);
      const priceCell = cleanCell(pending.price);
      const codeMatch = codeCell?.split(/\s+/).find((t) => CODE_TOKEN.test(t) && !CODE_STOPWORDS.has(t));
      const priceNums = priceCell ? [...priceCell.matchAll(NUM_RE)].map((m) => m[1]!) : [];
      if (codeMatch && priceNums.length) {
        const price = toNum(priceNums[priceNums.length - 1]!);
        const model = ctx.table?.hasVehicle ? cleanCell(pending.vehicle) : null;
        push({
          code: codeMatch,
          model,
          generation: generationOf(model),
          engine: cleanCell(pending.engine),
          rowLabel: cleanCell(pending.label),
          description: null,
          price,
          hours: null,
        });
        pending = {};
      }
      continue;
    }

    /* ------------------------------- Mode jetons -------------------------- */
    const parsed = parseRow(text, ctx.table);

    if (!parsed) {
      const kind = titleKind(text);
      if (kind === "famille") {
        ctx.family = text.trim();
        ctx.description = null;
        ctx.capturingDescription = false;
      } else if (kind === "operation") {
        ctx.operation = text.trim();
        ctx.description = null;
        ctx.capturingDescription = false;
      }

      else if (/\d/.test(text)) {
        uncertain.push(`page ${sourcePage ?? page.page} : « ${text.slice(0, 70)} » — ligne non exploitable`);
      }
      continue;
    }
    push(parsed);
  }

  ctx.pending = Object.keys(pending).length ? pending : null;

  if (!lines.length && !uncertain.length) {
    uncertain.push(`page ${sourcePage ?? page.page} : aucun forfait reconnu — à contrôler`);
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
  opts: {
    kind: SourceKind;
    fileName: string;
    version: string | null;
    context?: ParseContext;
    pageCount?: number;
  },
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
