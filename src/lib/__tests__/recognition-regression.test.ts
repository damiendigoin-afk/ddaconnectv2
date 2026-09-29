import { describe, expect, it, vi } from "vitest";
import { detectMedia, runDocPipeline, type PipelineDeps } from "../doc-pipeline";
import { odometerRules, plausibleMileage } from "../doc-rules";

function deps(over: Partial<PipelineDeps> = {}) {
  return {
    fallbackEnabled: vi.fn(async () => false), // réglage production : repli IA désactivé
    aiText: vi.fn(async () => null),
    aiVision: vi.fn(async () => null),
    logLocal: vi.fn(async () => {}),
    ...over,
  };
}
const IMG = "data:image/jpeg;base64,AAAA";
const PDF = "data:application/pdf;base64,AAAA";

describe("médias", () => {
  it("photo / PDF texte / PDF scanné", () => {
    expect(detectMedia(IMG, "")).toBe("photo");
    expect(detectMedia(PDF, "Facture ".repeat(40))).toBe("pdf_text");
    expect(detectMedia(PDF, "  ab  ")).toBe("pdf_scan");
    expect(detectMedia(null, "x")).toBe("none");
  });
});

describe("qualité métier compteur", () => {
  it("photo compteur lisible : kilométrage plausible sans IA", async () => {
    const d = deps();
    const r = await runDocPipeline({ kind: "odometer", text: "78 452 km\nTRIP 12,4", hasImage: true, media: "photo" }, d);
    expect(r.route).toBe("ocr_rules");
    expect(r.fields["mileage"]).toBe(78452);
    expect(d.aiVision).not.toHaveBeenCalled();
  });
  it("trip seul (12 km) n'est pas un succès : vision déclenchée même réglage désactivé", async () => {
    expect(odometerRules("12 km")["mileage"]).toBeNull();
    const d = deps({ aiVision: vi.fn(async () => ({ mileage: 78452, unit: "km" })) });
    const r = await runDocPipeline({ kind: "odometer", text: "12 km", hasImage: true, media: "photo" }, d);
    expect(d.aiVision).toHaveBeenCalledWith(["mileage"], true);
    expect(r.fields["mileage"]).toBe(78452);
    expect(r.route).toBe("ai_vision_fallback");
  });
  it("plausibilité", () => {
    expect(plausibleMileage("78 452")).toBe(78452);
    expect(plausibleMileage(Number.NaN)).toBeNull();
    expect(plausibleMileage(5_000_000)).toBeNull();
  });
});

describe("OR photographié", () => {
  it("OCR partiel (n° OR seul) : vision appelée, n° OR fiable conservé, reste complété", async () => {
    const d = deps({
      aiVision: vi.fn(async () => ({ order: { or_number: "99999", requested_work: "Vidange" }, vehicle: { plate: "FR-418-KV" } })),
    });
    const r = await runDocPipeline({ kind: "repair_order", text: "ORDRE DE REPARATION N° 16991", hasImage: true, media: "photo" }, d);
    expect(d.aiVision).toHaveBeenCalled();
    const order = r.fields["order"] as Record<string, unknown>;
    expect(order["or_number"]).toBe("16991");
    expect(order["requested_work"]).toBe("Vidange");
    expect((r.fields["vehicle"] as Record<string, unknown>)["plate"]).toBe("FR-418-KV");
  });
});

describe("documents d'achat", () => {
  const BL = `FAURIE AUTO SARLAT\nBON DE LIVRAISON N° 914776 du 28/09/2026\nRéf Désignation Qté PU HT Montant\nMI2055516 PNEU MICHELIN CROSSCLIMATE 2 2 95,40 190,80`;
  it("PDF texte lisible : extraction + règles, aucun appel IA", async () => {
    const d = deps();
    const r = await runDocPipeline({ kind: "purchase", text: BL, hasImage: true, media: "pdf_text", ctx: { suppliers: [{ name: "FAURIE AUTO SARLAT" }] } }, d);
    expect(r.route).toBe("ocr_rules");
    expect(d.aiVision).not.toHaveBeenCalled();
  });
  it("PDF texte incomplet, réglage désactivé : pas d'IA (priorité couche texte)", async () => {
    const d = deps();
    const r = await runDocPipeline({ kind: "purchase", text: "Facture sans lignes ".repeat(20), hasImage: true, media: "pdf_text" }, d);
    expect(r.route).toBe("manual");
    expect(d.aiVision).not.toHaveBeenCalled();
  });
  it("PDF scanné sans couche texte : vision directe, pas de repli texte", async () => {
    const d = deps({ fallbackEnabled: vi.fn(async () => true), aiVision: vi.fn(async () => ({ supplier: "X", lines: [{ reference: "A1" }] })) });
    const r = await runDocPipeline({ kind: "purchase", text: "", hasImage: true, media: "pdf_scan" }, d);
    expect(d.aiText).not.toHaveBeenCalled();
    expect(r.route).toBe("ai_vision_fallback");
    expect(r.missing).toEqual([]);
  });
  it("photo BL : fournisseur lu localement conservé, lignes complétées par la vision", async () => {
    const d = deps({ aiVision: vi.fn(async () => ({ supplier: "AUTRE", lines: [{ reference: "MI2055516", quantity: 2 }] })) });
    const r = await runDocPipeline({ kind: "purchase", text: "FAURIE AUTO SARLAT\nBON DE LIVRAISON N° 914776", hasImage: true, media: "photo", ctx: { suppliers: [{ name: "FAURIE AUTO SARLAT" }] } }, d);
    expect(r.fields["supplier"]).toBe("FAURIE AUTO SARLAT");
    expect((r.fields["lines"] as unknown[]).length).toBe(1);
  });
});
