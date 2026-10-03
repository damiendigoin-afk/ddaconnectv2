import { describe, expect, it } from "vitest";

import { classifyLocal } from "../bench-classify";
import { anonymizeRaw, buildTestExport, type BenchRun } from "../bench-export";
import { TREAD_DEPTH_NOTE, enforceTireDepthRule, isAllowedBenchModel, parseModelJson, pipelineKind } from "../bench-schema";
import { diffOutputs, scoreOutput } from "../bench-score";

describe("bench-score", () => {
  it("deux champs vides ne comptent jamais comme succès", () => {
    const s = scoreOutput({ document: { plate: null } }, { document: { plate: null } });
    expect(s.global.total).toBe(0);
    expect(s.global.rate).toBeNull();
  });
  it("correct / faux / manquant / inventé", () => {
    const s = scoreOutput(
      { document: { plate: "AB-123-CD", or_number: "50873", vin: "VF1XXX" } },
      { document: { plate: "ab123cd", or_number: "50874", supplier: "INVENTÉ" } },
    );
    const v = Object.fromEntries(s.details.map((d) => [d.path, d.verdict]));
    expect(v["document.plate"]).toBe("correct");
    expect(v["document.or_number"]).toBe("faux");
    expect(v["document.vin"]).toBe("manquant");
    expect(v["document.supplier"]).toBe("invente");
    expect(s.global.correct).toBe(1);
    expect(s.global.wrong).toBe(2);
    expect(s.global.missing).toBe(1);
  });
  it("lignes appariées par référence exacte puis position, montants à 0,01 près", () => {
    const s = scoreOutput(
      { lines: [{ reference: "AH340", unit_price_ht: 13.72 }, { reference: "PORT", unit_price_ht: 5 }] },
      { lines: [{ reference: "PORT", unit_price_ht: "5,00" }, { reference: "AH 340", unit_price_ht: "13,72 €" }] },
    );
    expect(s.references.rate).toBe(100);
    expect(s.amounts.rate).toBe(100);
  });
  it("tire.height n'est pas compté comme montant", () => {
    const s = scoreOutput({ tire: { height: 55 } }, { tire: { height: 55 } });
    expect(s.amounts.total).toBe(0);
  });
  it("diff A/B signale différent et non trouvé", () => {
    const d = diffOutputs({ document: { plate: "AB-123-CD", date: "2026-10-01" } }, { document: { plate: "AB-123-CE" } });
    expect(d.find((r) => r.path === "document.plate")?.status).toBe("different");
    expect(d.find((r) => r.path === "document.date")?.status).toBe("absent_b");
  });
});

describe("bench-schema", () => {
  it("modèle B limité aux Gemini vision en V1", () => {
    expect(isAllowedBenchModel("google/gemini-3.8-flash")).toBe(true);
    expect(isAllowedBenchModel("openai/gpt-6-astra")).toBe(false);
  });
  it("profondeur de pneu jamais inventée sans mesure fiable", () => {
    const o = enforceTireDepthRule({ tire: { tread_depth_mm: 4 } });
    expect(o.tire?.tread_depth_mm).toBeNull();
    expect(o.tire?.tread_depth_note).toBe(TREAD_DEPTH_NOTE);
  });
  it("JSON entouré de texte relu, JSON invalide => null", () => {
    expect(parseModelJson('```json\n{"document_type":"tire"}\n```')?.document_type).toBe("tire");
    expect(parseModelJson("pas de json")).toBeNull();
  });
  it("pas de pipeline IA pour les pneus (OCR local en production)", () => {
    expect(pipelineKind("tire")).toBeNull();
    expect(pipelineKind("delivery_note")).toBe("purchase");
  });
});

describe("bench-classify", () => {
  it("détecte un OR et un ticket batterie", () => {
    expect(classifyLocal("ORDRE DE REPARATION N° 50873 Travaux à effectuer Remarque du client")?.kind).toBe("repair_order");
    expect(classifyLocal("MIDTRONICS test batterie CCA 540 SOH 82% SOC 75%")?.kind).toBe("battery");
    expect(classifyLocal("")).toBeNull();
  });
});

describe("bench-export", () => {
  const run: BenchRun = {
    variant: "A", model: "google/gemini-3.5-flash", promptVersion: "v", promptHash: "h", promptText: "p", schemaVersion: "s", docKind: "repair_order",
    startedAt: "2026-10-01T00:00:00Z", mediaMs: 1, aiMs: 2, parseMs: 3, serverMs: 4, totalMs: 5, tokensIn: 6, tokensOut: 7, credits: 0.01,
    httpStatus: 200, success: true, cacheHit: false, failureReason: null, route: null, aiCalls: 1,
    parsed: { document: { client: "GUERE", email: "a@b.fr", vin: "VF1RFB00012345678", plate: "DP-043-WB", or_number: "50873" } },
    rawText: "contact a@b.fr 06 12 34 56 78",
  };
  it("anonymise client, coordonnées, VIN et immat mais garde l'OR", () => {
    const e = buildTestExport({ file_name: "or.jpg", sha256: "a".repeat(64), storage_paths: [], page_count: 1, photo_count: 1, tested_at: "x",
      detected_kind: "repair_order", kind_confidence: 0.9, kind_source: "local", corrected_kind: null, app_version: null, timings_client: {}, runs: [run], expected: null }, true);
    const d = e.runs[0]!.parsed!.document!;
    expect(d.client).toBe("[anonymisé]");
    expect(d.email).toBe("[anonymisé]");
    expect(String(d.vin).endsWith("5678")).toBe(true);
    expect(d.vin).not.toBe("VF1RFB00012345678");
    expect(d.plate).not.toBe("DP-043-WB");
    expect(d.or_number).toBe("50873");
    expect(e.file_name).not.toBe("or.jpg");
    expect(anonymizeRaw(run.rawText)).not.toContain("a@b.fr");
  });
});
