import { describe, expect, it } from "vitest";

import {
  consolidate,
  offsetLines,
  pendingBatches,
  planBatches,
  summarize,
  summaryText,
  upsertOutcome,
  type BatchOutcome,
  type JobState,
} from "../packages-batch";
import type { DetectedLine } from "../packages-import";

const line = (code: string, page: number | null, over: Partial<DetectedLine> = {}): DetectedLine => ({
  source_kind: "renault_public",
  source_file_name: "Renault-PUBLIC-C.pdf",
  source_version: "01/2026",
  source_page: page,
  brand: "Renault",
  model: null,
  segment: null,
  energies: [],
  operation_code: code,
  label: code,
  price_value: 100,
  price_basis: "ttc",
  hours: null,
  parts_ht: null,
  year_from: null,
  year_to: null,
  notes: null,
  ...over,
});

const outcome = (index: number, from: number, to: number, lines: DetectedLine[], over: Partial<BatchOutcome> = {}): BatchOutcome => ({
  index,
  from,
  to,
  status: "done",
  attempts: 1,
  lines,
  warnings: [],
  ...over,
});

const job = (outcomes: BatchOutcome[], totalPages = 249, batchSize = 12): JobState => ({
  jobId: "j",
  fileName: "Renault-PUBLIC-C.pdf",
  fileSize: 1,
  sourceKind: "renault_public",
  version: "01/2026",
  totalPages,
  batchSize,
  outcomes,
  updatedAt: "",
});

describe("découpage en lots", () => {
  it("couvre les 249 pages sans troncature", () => {
    const batches = planBatches(249, 12);
    expect(batches).toHaveLength(21);
    expect(batches[0]).toEqual({ index: 0, from: 1, to: 12 });
    expect(batches.at(-1)).toEqual({ index: 20, from: 241, to: 249 });
    const pages = batches.reduce((s, b) => s + (b.to - b.from + 1), 0);
    expect(pages).toBe(249);
  });

  it("ne s'arrête jamais à un seuil arbitraire (400 pages)", () => {
    expect(planBatches(400, 12).at(-1)?.to).toBe(400);
  });

  it("recale les pages relatives sur le document complet", () => {
    const out = offsetLines([line("A", 1), line("B", 3), line("C", 45)], { index: 3, from: 37, to: 48 });
    expect(out.map((l) => l.source_page)).toEqual([37, 39, 45]);
  });
});

describe("consolidation multi-lots", () => {
  it("fusionne les lots et déduplique en gardant la page la plus basse", () => {
    const merged = consolidate([
      outcome(1, 13, 24, [line("A", 20), line("B", 22)]),
      outcome(0, 1, 12, [line("A", 4)]),
    ]);
    expect(merged.lines).toHaveLength(2);
    expect(merged.lines.find((l) => l.operation_code === "A")?.source_page).toBe(4);
    expect(merged.duplicates).toBe(1);
  });

  it("marque les pages d'un lot définitivement en échec sans annuler le reste", () => {
    const merged = consolidate([
      outcome(0, 1, 12, [line("A", 2)]),
      outcome(1, 13, 24, [], { status: "failed", attempts: 3, error: "analyse impossible" }),
    ]);
    expect(merged.lines).toHaveLength(1);
    expect(merged.warnings[0]).toContain("Pages 13 à 24 à contrôler");
  });
});

describe("progression et reprise", () => {
  it("calcule la progression et le résumé final", () => {
    const state = job([
      outcome(0, 1, 12, [line("A", 2)]),
      outcome(1, 13, 24, [line("B", 14)]),
    ]);
    const s = summarize(state);
    expect(s.pagesDone).toBe(24);
    expect(s.percent).toBe(10);
    expect(s.complete).toBe(false);
    expect(summaryText(s)).toBe("24 page(s) analysée(s) / 249 — 2 forfait(s) détecté(s)");
  });

  it("état final avec pages en erreur", () => {
    const all = planBatches(24, 12).map((b, i) =>
      i === 1 ? outcome(b.index, b.from, b.to, [], { status: "failed", attempts: 3 }) : outcome(b.index, b.from, b.to, [line("A", 2)]),
    );
    const s = summarize(job(all, 24));
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(s.pagesFailed).toBe(12);
    expect(summaryText(s)).toContain("12 page(s) à contrôler");
  });

  it("ne relance que les lots manquants ou en échec après interruption", () => {
    const state = job([
      outcome(0, 1, 12, [line("A", 2)]),
      outcome(1, 13, 24, [], { status: "failed", attempts: 3 }),
    ]);
    const pending = pendingBatches(state);
    expect(pending[0]).toEqual({ index: 1, from: 13, to: 24 });
    expect(pending).toHaveLength(20);
    expect(pending.some((b) => b.index === 0)).toBe(false);
  });

  it("le retry réussi remplace le lot en échec", () => {
    let state = job([outcome(0, 1, 12, [], { status: "failed", attempts: 3 })], 12);
    state = upsertOutcome(state, outcome(0, 1, 12, [line("A", 3)], { attempts: 2 }));
    expect(state.outcomes).toHaveLength(1);
    expect(summarize(state)).toMatchObject({ pagesFailed: 0, linesDetected: 1, complete: true });
  });
});
