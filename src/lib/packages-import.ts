/**
 * Import du référentiel forfaits Renault / Dacia.
 *
 * Logique pure (testable) : normalisation des lignes détectées, conversion HT/TTC
 * selon la convention du mémento, clé de rapprochement idempotente, et upsert
 * sans doublon dans `service_packages` avec historique des versions.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ServicePackage } from "./pricing-engine";

export const VAT = 0.2;

export type SourceKind = "renault_public" | "renault_pro_lld" | "dacia_public";
export type PriceBasis = "ht" | "ttc";

export const SOURCE_KINDS: {
  key: SourceKind;
  label: string;
  brand: string;
  basis: PriceBasis;
  /** Zone tarifaire du mémento. */
  zone: string;
  /** Périmètre commercial : Public ou Pro / LLD. */
  tier: string;
}[] = [
  { key: "renault_public", label: "Renault Public Zone C", brand: "Renault", basis: "ttc", zone: "C", tier: "public" },
  { key: "renault_pro_lld", label: "Renault Pro / LLD Zone C", brand: "Renault", basis: "ht", zone: "C", tier: "pro_lld" },
  { key: "dacia_public", label: "Dacia Public Zone C", brand: "Dacia", basis: "ttc", zone: "C", tier: "public" },
];

export const SOURCE_LABEL: Record<SourceKind, string> = Object.fromEntries(
  SOURCE_KINDS.map((s) => [s.key, s.label]),
) as Record<SourceKind, string>;

export function sourceDef(kind: SourceKind) {
  return SOURCE_KINDS.find((s) => s.key === kind) ?? SOURCE_KINDS[0]!;
}

export type DetectedLine = {
  source_kind: SourceKind;
  source_file_name: string;
  source_version: string | null;
  source_page: number | null;
  brand: string;
  model: string | null;
  /** Génération / déclinaison de gamme si identifiable (ex. « II »). */
  generation?: string | null;
  /** Motorisation telle qu'imprimée (ex. « 1.3 16V »). */
  engine?: string | null;
  /** Famille de prestation (titre de chapitre du mémento). */
  family?: string | null;
  /** Libellé d'opération du tableau en cours. */
  operation_title?: string | null;
  /** Descriptif / contenu de la ligne. */
  description?: string | null;
  zone?: string | null;
  tier?: string | null;
  segment: string | null;
  energies: string[];
  operation_code: string;
  label: string;
  /** Prix tel qu'il figure dans le mémento (nature indiquée par `price_basis`). */
  price_value: number | null;
  price_basis: PriceBasis;
  hours: number | null;
  parts_ht: number | null;
  year_from: number | null;
  year_to: number | null;
  notes: string | null;
};

export type ParseOutcome = { lines: DetectedLine[]; warnings: string[] };

/* ------------------------------- Helpers -------------------------------- */

const clean = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v == null ? "" : String(v).trim();

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/[€\s\u00a0]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Convertit le prix source vers HT/TTC sans jamais appliquer deux fois la TVA. */
export function toPrices(value: number | null, basis: PriceBasis) {
  if (value == null) return { price_ht: null, price_ttc: null };
  return basis === "ttc"
    ? { price_ht: round2(value / (1 + VAT)), price_ttc: round2(value) }
    : { price_ht: round2(value), price_ttc: round2(value * (1 + VAT)) };
}

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * Clé de rapprochement : référentiel + marque + code opération + contexte
 * (modèle / segment / énergies / période). Réimporter le même mémento ne crée
 * donc aucun doublon.
 */
export function dedupeKey(l: {
  source_kind: string;
  brand: string;
  operation_code: string;
  model?: string | null;
  engine?: string | null;
  segment?: string | null;
  energies?: string[] | null;
  year_from?: number | null;
  year_to?: number | null;
}): string {
  return [
    l.source_kind,
    norm(l.brand),
    norm(l.operation_code),
    norm(l.model ?? ""),
    norm(l.engine ?? ""),
    norm(l.segment ?? ""),
    [...(l.energies ?? [])].map(norm).sort().join("+"),
    l.year_from ?? "",
    l.year_to ?? "",
  ].join("|");
}

const ENERGY_MAP: Record<string, string> = {
  ESSENCE: "essence",
  ESS: "essence",
  DIESEL: "diesel",
  DCI: "diesel",
  GASOIL: "diesel",
  HYBRIDE: "hybride",
  HEV: "hybride",
  ETECH: "hybride",
  ELECTRIQUE: "electrique",
  EV: "electrique",
  GPL: "gpl",
};

export function parseEnergies(v: unknown): string[] {
  const raw = clean(v);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;/|+]/)
        .map((p) => ENERGY_MAP[norm(p)] ?? null)
        .filter((p): p is string => !!p),
    ),
  ];
}

/* --------------------------- Tableurs CSV / XLSX -------------------------- */

const HEADERS: Record<string, string[]> = {
  operation_code: ["code", "codeoperation", "codeforfait", "operation", "reference", "ref"],
  label: ["libelle", "designation", "intitule", "description", "prestation"],
  brand: ["marque", "brand"],
  model: ["modele", "model", "vehicule"],
  segment: ["segment", "gamme"],
  energies: ["energie", "energies", "motorisation", "carburant"],
  price: ["prix", "prixttc", "prixht", "tarif", "montant"],
  hours: ["temps", "heures", "tempsbareme", "h"],
  parts_ht: ["pieces", "piecesht", "fourniture", "fournituresht"],
  year_from: ["anneedebut", "annedebut", "millesimedebut", "du", "datedebut"],
  year_to: ["anneefin", "millesimefin", "au", "datefin"],
};

function headerIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (map[field] != null) continue;
      if (aliases.some((a) => n === norm(a) || n.startsWith(norm(a)))) map[field] = i;
    }
  });
  return map;
}

/**
 * Normalise un tableau brut (CSV/XLSX déjà structuré) en lignes détectées.
 * Toute ligne inexploitable est signalée, jamais complétée par déduction.
 */
export function linesFromRows(
  rows: string[][],
  ctx: { source_kind: SourceKind; source_file_name: string; source_version: string | null },
): ParseOutcome {
  const warnings: string[] = [];
  const nonEmpty = rows.filter((r) => r.some((c) => clean(c) !== ""));
  if (nonEmpty.length < 2) return { lines: [], warnings: ["Fichier vide ou sans en-tête exploitable."] };

  const headers = nonEmpty[0]!.map(clean);
  const idx = headerIndex(headers);
  if (idx["operation_code"] == null || idx["label"] == null) {
    return {
      lines: [],
      warnings: [
        "En-têtes non reconnus : colonnes « code » et « libellé » obligatoires (colonnes trouvées : " +
          headers.join(", ") +
          ").",
      ],
    };
  }

  const def = sourceDef(ctx.source_kind);
  const at = (r: string[], f: string) => (idx[f] == null ? "" : clean(r[idx[f]!]));
  const lines: DetectedLine[] = [];

  nonEmpty.slice(1).forEach((r, i) => {
    const code = at(r, "operation_code");
    const label = at(r, "label");
    if (!code || !label) {
      warnings.push(`Ligne ${i + 2} ignorée : code ou libellé manquant.`);
      return;
    }
    const price = toNumber(at(r, "price"));
    const hours = toNumber(at(r, "hours"));
    if (price == null && hours == null) {
      warnings.push(`Ligne ${i + 2} (${code}) ignorée : ni prix ni temps exploitable.`);
      return;
    }
    lines.push({
      source_kind: ctx.source_kind,
      source_file_name: ctx.source_file_name,
      source_version: ctx.source_version,
      source_page: null,
      brand: at(r, "brand") || def.brand,
      model: at(r, "model") || null,
      segment: at(r, "segment") || null,
      energies: parseEnergies(at(r, "energies")),
      operation_code: code.toUpperCase(),
      label,
      price_value: price,
      price_basis: def.basis,
      hours,
      parts_ht: toNumber(at(r, "parts_ht")),
      year_from: toNumber(at(r, "year_from")),
      year_to: toNumber(at(r, "year_to")),
      notes: null,
    });
  });

  return { lines, warnings };
}

/** Normalise la sortie JSON de l'analyse serveur d'un PDF. */
export function linesFromAi(
  raw: unknown,
  ctx: { source_kind: SourceKind; source_file_name: string; source_version: string | null },
): ParseOutcome {
  const obj = (raw ?? {}) as { lines?: unknown[]; warnings?: unknown[]; version?: unknown };
  const warnings = (obj.warnings ?? []).map((w) => clean(w)).filter(Boolean);
  const def = sourceDef(ctx.source_kind);
  const version = ctx.source_version || clean(obj.version) || null;
  const lines: DetectedLine[] = [];

  for (const item of obj.lines ?? []) {
    const l = (item ?? {}) as Record<string, unknown>;
    const code = clean(l["operation_code"] ?? l["code"]).toUpperCase();
    const label = clean(l["label"] ?? l["libelle"]);
    if (!code || !label) {
      warnings.push("Une ligne détectée sans code ou libellé fiable a été écartée.");
      continue;
    }
    const price = toNumber(l["price"] ?? l["price_value"] ?? l["prix"]);
    const hours = toNumber(l["hours"] ?? l["temps"]);
    if (price == null && hours == null) {
      warnings.push(`Forfait ${code} : ni prix ni temps lisible, ligne écartée.`);
      continue;
    }
    const basis = clean(l["price_basis"]).toLowerCase() === "ht" ? "ht" : def.basis;
    lines.push({
      source_kind: ctx.source_kind,
      source_file_name: ctx.source_file_name,
      source_version: version,
      source_page: toNumber(l["page"]) ?? null,
      brand: clean(l["brand"]) || def.brand,
      model: clean(l["model"]) || null,
      segment: clean(l["segment"]) || null,
      energies: parseEnergies(l["energies"] ?? l["energy"]),
      operation_code: code,
      label,
      price_value: price,
      price_basis: price == null ? def.basis : (basis as PriceBasis),
      hours,
      parts_ht: toNumber(l["parts_ht"]),
      year_from: toNumber(l["year_from"]),
      year_to: toNumber(l["year_to"]),
      notes: clean(l["notes"]) || null,
    });
  }
  return { lines, warnings };
}

/* ------------------------------ Persistance ------------------------------ */

export type PackageRow = ServicePackage & {
  source_kind: string | null;
  source_file_name: string | null;
  source_version: string | null;
  source_page: number | null;
  family?: string | null;
  operation_title?: string | null;
  description?: string | null;
  engine?: string | null;
  generation?: string | null;
  zone?: string | null;
  tier?: string | null;
  archived_at?: string | null;
  price_ht: number | null;
  price_basis: string;
  imported_at: string | null;
  dedupe_key: string | null;
};

export function rowFromLine(line: DetectedLine, userId: string | null, importId?: string | null) {
  const { price_ht, price_ttc } = toPrices(line.price_value, line.price_basis);
  return {
    brand: line.brand,
    model: line.model,
    generation: line.generation ?? null,
    engine: line.engine ?? null,
    family: line.family ?? null,
    operation_title: line.operation_title ?? null,
    description: line.description ?? null,
    zone: line.zone ?? null,
    tier: line.tier ?? null,
    segment: line.segment,
    energies: line.energies,
    operation_code: line.operation_code,
    label: line.label,
    hours: line.hours,
    parts_ht: line.parts_ht,
    price_ht,
    price_ttc,
    price_basis: line.price_basis,
    year_from: line.year_from,
    year_to: line.year_to,
    notes: line.notes,
    active: true,
    archived_at: null,
    source_kind: line.source_kind,
    source_file_name: line.source_file_name,
    source_version: line.source_version,
    source_page: line.source_page,
    import_id: importId ?? null,
    imported_at: new Date().toISOString(),
    imported_by: userId,
    dedupe_key: dedupeKey(line),
  };
}

/**
 * GARDE-FOU DE PERSISTANCE. Une ligne dont le libellé, le titre d'opération ou
 * la famille est en réalité un en-tête de tableau ou une ligne de contenu n'est
 * jamais enregistrée : elle part « à contrôler ». Idem pour une page source
 * impossible (hors 1..pageCount).
 */
export function sanitizeLines(
  lines: DetectedLine[],
  opts?: { pageCount?: number | null },
): ParseOutcome {
  const kept: DetectedLine[] = [];
  const warnings: string[] = [];
  const max = opts?.pageCount ?? null;
  for (const l of lines) {
    if (isForbiddenLabel(l.label)) {
      warnings.push(`Forfait ${l.operation_code} écarté : libellé non exploitable (« ${l.label} »).`);
      continue;
    }
    const page = l.source_page;
    if (page != null && (!Number.isInteger(page) || page < 1 || (max != null && page > max))) {
      warnings.push(
        `Forfait ${l.operation_code} écarté : page source ${page} impossible (document de ${max ?? "?"} pages).`,
      );
      continue;
    }
    kept.push({
      ...l,
      operation_title: isForbiddenLabel(l.operation_title) ? null : (l.operation_title ?? null),
      family: isForbiddenLabel(l.family) ? null : (l.family ?? null),
      description: isForbiddenLabel(l.description) ? null : (l.description ?? null),
    });
  }
  return { lines: kept, warnings };
}


/** Vrai si la version importée modifie le prix, le temps ou la période. */
export function hasChanged(
  existing: Pick<PackageRow, "price_ttc" | "price_ht" | "hours" | "year_from" | "year_to">,
  next: { price_ttc: number | null; price_ht: number | null; hours: number | null; year_from: number | null; year_to: number | null },
): boolean {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return (
    num(existing.price_ttc) !== num(next.price_ttc) ||
    num(existing.price_ht) !== num(next.price_ht) ||
    num(existing.hours) !== num(next.hours) ||
    num(existing.year_from) !== num(next.year_from) ||
    num(existing.year_to) !== num(next.year_to)
  );
}

export type ImportResult = { inserted: number; updated: number; unchanged: number; matched: number };

/**
 * Upsert idempotent. Les forfaits saisis manuellement (sans clé) portant le même
 * code opération / marque sont rapprochés au lieu d'être dupliqués.
 */
export async function importLines(
  lines: DetectedLine[],
  opts: {
    userId: string | null;
    userName: string | null;
    warnings: string[];
    sourceKind: SourceKind;
    fileName: string;
    version: string | null;
    /** Import déjà ouvert (écriture progressive par lots de pages). */
    importId?: string | null;
  },
): Promise<ImportResult & { importId: string | null; rejected: number; warnings: string[] }> {
  const result: ImportResult = { inserted: 0, updated: 0, unchanged: 0, matched: 0 };
  const safe = sanitizeLines(lines, { pageCount: opts.pageCount ?? null });
  const rejected = lines.length - safe.lines.length;
  const base = { rejected, warnings: safe.warnings };
  if (!safe.lines.length) return { ...result, importId: opts.importId ?? null, ...base };
  lines = safe.lines;

  if (opts.importId)
    return { ...(await writeLines(lines, opts, opts.importId)), importId: opts.importId, ...base };


  const { data: importRow } = await supabase
    .from("service_package_imports")
    .insert({
      source_kind: opts.sourceKind,
      file_name: opts.fileName,
      version_label: opts.version,
      lines_detected: lines.length,
      warnings: opts.warnings as never,
      imported_by: opts.userId,
      imported_by_name: opts.userName,
    })
    .select("id")
    .maybeSingle();
  const importId = (importRow?.id as string | undefined) ?? null;
  const written = await writeLines(lines, opts, importId);
  Object.assign(result, written);

  if (importId) {
    await supabase
      .from("service_package_imports")
      .update({ lines_imported: result.inserted, lines_updated: result.updated })
      .eq("id", importId);
  }
  return { ...result, importId };
}

/** Écriture idempotente d'un lot de lignes (rapprochement par clé). */
async function writeLines(
  lines: DetectedLine[],
  opts: { userId: string | null },
  importId: string | null,
): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, updated: 0, unchanged: 0, matched: 0 };
  const { data: existingRaw } = await supabase.from("service_packages").select("*");
  const existing = (existingRaw ?? []) as PackageRow[];
  const byKey = new Map(existing.filter((p) => p.dedupe_key).map((p) => [p.dedupe_key!, p]));
  const legacy = new Map(
    existing
      .filter((p) => !p.dedupe_key)
      .map((p) => [`${norm(p.brand)}|${norm(p.operation_code)}`, p]),
  );

  for (const line of lines) {
    const payload = rowFromLine(line, opts.userId);
    const prior = byKey.get(payload.dedupe_key) ?? legacy.get(`${norm(line.brand)}|${norm(line.operation_code)}`);

    if (!prior) {
      const { error } = await supabase.from("service_packages").insert(payload as never);
      if (!error) result.inserted += 1;
      continue;
    }

    result.matched += 1;
    if (!hasChanged(prior, payload)) {
      await supabase
        .from("service_packages")
        .update({
          source_kind: payload.source_kind,
          source_file_name: payload.source_file_name,
          source_version: payload.source_version,
          source_page: payload.source_page,
          dedupe_key: payload.dedupe_key,
          imported_at: payload.imported_at,
          imported_by: payload.imported_by,
        } as never)
        .eq("id", prior.id);
      result.unchanged += 1;
      continue;
    }

    await supabase.from("service_package_history").insert({
      package_id: prior.id,
      dedupe_key: payload.dedupe_key,
      import_id: importId,
      previous: prior as never,
      changed_by: opts.userId,
    } as never);
    const { error } = await supabase
      .from("service_packages")
      .update({ ...payload, updated_at: new Date().toISOString() } as never)
      .eq("id", prior.id);
    if (!error) result.updated += 1;
  }

  return result;
}


/* ----------------------- Versions actives / archivées ---------------------- */

/** Ouvre un import (utilisé pour l'écriture progressive d'un gros mémento). */
export async function createImportRun(opts: {
  sourceKind: SourceKind;
  fileName: string;
  version: string | null;
  userId: string | null;
  userName: string | null;
}): Promise<string | null> {
  const { data } = await supabase
    .from("service_package_imports")
    .insert({
      source_kind: opts.sourceKind,
      file_name: opts.fileName,
      version_label: opts.version,
      lines_detected: 0,
      imported_by: opts.userId,
      imported_by_name: opts.userName,
    })
    .select("id")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function updateImportRun(
  importId: string,
  totals: { detected: number; inserted: number; updated: number; warnings: string[] },
) {
  await supabase
    .from("service_package_imports")
    .update({
      lines_detected: totals.detected,
      lines_imported: totals.inserted,
      lines_updated: totals.updated,
      warnings: totals.warnings.slice(0, 500) as never,
    })
    .eq("id", importId);
}

/**
 * Le dernier mémento d'un même périmètre devient ACTIF : les forfaits des
 * versions antérieures du même référentiel sont archivés (consultables), jamais
 * supprimés. Sans version identifiée, rien n'est archivé.
 */
export async function archivePreviousVersions(sourceKind: SourceKind, version: string | null): Promise<number> {
  if (!version) return 0;
  const { data } = await supabase
    .from("service_packages")
    .update({ active: false, archived_at: new Date().toISOString() } as never)
    .eq("source_kind", sourceKind)
    .eq("active", true)
    .neq("source_version", version)
    .select("id");
  return (data ?? []).length;
}

/** Recherche simple : code, opération/libellé, famille, modèle, moteur, mots-clés. */
export async function searchPackages(query: string, limit = 60): Promise<PackageRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%,]/g, " ")}%`;
  const { data, error } = await supabase
    .from("service_packages")
    .select("*")
    .or(
      [
        `operation_code.ilike.${like}`,
        `label.ilike.${like}`,
        `operation_title.ilike.${like}`,
        `family.ilike.${like}`,
        `model.ilike.${like}`,
        `engine.ilike.${like}`,
        `description.ilike.${like}`,
      ].join(","),
    )
    .order("active", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}
