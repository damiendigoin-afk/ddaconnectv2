/**
 * Analyse par lots d'un mémento forfaits PDF volumineux (100 à 400+ pages).
 *
 * Logique pure et testable : découpage en lots de pages, décalage des pages
 * réelles, consolidation + déduplication multi-lots, résumé final et
 * persistance de l'état de job pour reprise après rafraîchissement.
 */
import { dedupeKey, type DetectedLine } from "./packages-import";

export const DEFAULT_BATCH_SIZE = 12;

export type PageBatch = { index: number; from: number; to: number };

/** Découpe [1..totalPages] en lots contigus. Jamais de troncature volontaire. */
export function planBatches(totalPages: number, size = DEFAULT_BATCH_SIZE): PageBatch[] {
  const total = Math.max(0, Math.floor(totalPages));
  const step = Math.max(1, Math.floor(size));
  const batches: PageBatch[] = [];
  for (let from = 1; from <= total; from += step) {
    batches.push({ index: batches.length, from, to: Math.min(total, from + step - 1) });
  }
  return batches;
}

/** Recale les pages retournées par l'IA (relatives au lot) sur le PDF complet. */
export function offsetLines(lines: DetectedLine[], batch: PageBatch): DetectedLine[] {
  const span = batch.to - batch.from + 1;
  return lines.map((l) => {
    const p = l.source_page;
    const abs = p == null ? null : p >= batch.from && p <= batch.to ? p : batch.from + Math.min(Math.max(p, 1), span) - 1;
    return { ...l, source_page: abs };
  });
}

export type BatchOutcome = {
  index: number;
  from: number;
  to: number;
  status: "done" | "failed";
  attempts: number;
  lines: DetectedLine[];
  warnings: string[];
  error?: string;
};

export type JobState = {
  jobId: string;
  fileName: string;
  fileSize: number;
  sourceKind: string;
  version: string | null;
  totalPages: number;
  batchSize: number;
  outcomes: BatchOutcome[];
  updatedAt: string;
};

/** Consolide les lots : lignes dédupliquées (1re occurrence = page la plus basse) + warnings. */
export function consolidate(outcomes: BatchOutcome[]): {
  lines: DetectedLine[];
  warnings: string[];
  duplicates: number;
} {
  const seen = new Map<string, DetectedLine>();
  let duplicates = 0;
  const warnings: string[] = [];

  for (const o of [...outcomes].sort((a, b) => a.from - b.from)) {
    for (const w of o.warnings) warnings.push(`p.${o.from}–${o.to} — ${w}`);
    if (o.status === "failed") {
      warnings.push(`Pages ${o.from} à ${o.to} à contrôler : ${o.error || "analyse impossible"}.`);
      continue;
    }
    for (const l of o.lines) {
      const key = dedupeKey(l);
      const prior = seen.get(key);
      if (!prior) {
        seen.set(key, l);
        continue;
      }
      duplicates += 1;
      if ((l.source_page ?? Infinity) < (prior.source_page ?? Infinity)) seen.set(key, l);
    }
  }
  return { lines: [...seen.values()], warnings, duplicates };
}

export type JobSummary = {
  pagesDone: number;
  pagesFailed: number;
  totalPages: number;
  batchesDone: number;
  batchesFailed: number;
  linesDetected: number;
  warnings: number;
  percent: number;
  complete: boolean;
};

export function summarize(state: JobState): JobSummary {
  const pages = (o: BatchOutcome) => o.to - o.from + 1;
  const done = state.outcomes.filter((o) => o.status === "done");
  const failed = state.outcomes.filter((o) => o.status === "failed");
  const { lines, warnings } = consolidate(state.outcomes);
  const settled = done.reduce((s, o) => s + pages(o), 0) + failed.reduce((s, o) => s + pages(o), 0);
  return {
    pagesDone: done.reduce((s, o) => s + pages(o), 0),
    pagesFailed: failed.reduce((s, o) => s + pages(o), 0),
    totalPages: state.totalPages,
    batchesDone: done.length,
    batchesFailed: failed.length,
    linesDetected: lines.length,
    warnings: warnings.length,
    percent: state.totalPages ? Math.round((settled / state.totalPages) * 100) : 0,
    complete: settled >= state.totalPages && state.totalPages > 0,
  };
}

/** Lots restant à traiter (les lots réussis ne sont jamais relancés). */
export function pendingBatches(state: JobState, retryFailed = true): PageBatch[] {
  const all = planBatches(state.totalPages, state.batchSize);
  const byIndex = new Map(state.outcomes.map((o) => [o.index, o]));
  return all.filter((b) => {
    const o = byIndex.get(b.index);
    if (!o) return true;
    return retryFailed ? o.status === "failed" : false;
  });
}

export function upsertOutcome(state: JobState, outcome: BatchOutcome): JobState {
  const outcomes = state.outcomes.filter((o) => o.index !== outcome.index);
  outcomes.push(outcome);
  outcomes.sort((a, b) => a.index - b.index);
  return { ...state, outcomes, updatedAt: new Date().toISOString() };
}

export function summaryText(s: JobSummary): string {
  const pages = `${s.pagesDone} page(s) analysée(s) / ${s.totalPages}`;
  const failed = s.pagesFailed ? ` — ${s.pagesFailed} page(s) à contrôler` : "";
  return `${pages} — ${s.linesDetected} forfait(s) détecté(s)${failed}`;
}

/* --------------------- Persistance locale (reprise) ---------------------- */

const STORE_KEY = "dda.packages-import.job";

export function jobIdFor(fileName: string, fileSize: number, sourceKind: string, version: string | null) {
  return [fileName, fileSize, sourceKind, version ?? ""].join("|");
}

export function saveJob(state: JobState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* quota dépassé : la reprise ne sera pas disponible, le traitement continue. */
  }
}

export function loadJob(): JobState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JobState;
    return parsed && Array.isArray(parsed.outcomes) && parsed.totalPages > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearJob(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
