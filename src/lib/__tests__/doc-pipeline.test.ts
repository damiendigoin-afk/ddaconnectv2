import { describe, expect, it, vi } from "vitest";

import { runDocPipeline, type PipelineDeps } from "../doc-pipeline";
import { expenseRules, orOrPlateRules, purchaseRules } from "../doc-rules";

function deps(over: Partial<PipelineDeps> = {}) {
  const d = {
    fallbackEnabled: vi.fn(async () => true),
    aiText: vi.fn(async () => null),
    aiVision: vi.fn(async () => null),
    logLocal: vi.fn(async () => {}),
    ...over,
  };
  return d;
}

const BL_FAURIE = `FAURIE AUTO SARLAT
Route de Vitrac 24200 SARLAT
BON DE LIVRAISON N° 914776 du 28/09/2026
Mes références : HG 732 GH
Réf Désignation Qté PU HT Montant
MI2055516 PNEU MICHELIN CROSSCLIMATE 2 2 95,40 190,80
Total HT 190,80`;

describe("pipeline documentaire — OCR/règles avant IA", () => {
  it("BL lisible d'un fournisseur connu : aucun appel IA", async () => {
    const d = deps();
    const r = await runDocPipeline({ kind: "purchase", text: BL_FAURIE, hasImage: true, ctx: { suppliers: [{ name: "FAURIE AUTO SARLAT" }] } }, d);
    expect(r.route).toBe("ocr_rules");
    expect(r.aiCalls).toBe(0);
    expect(d.aiText).not.toHaveBeenCalled();
    expect(d.aiVision).not.toHaveBeenCalled();
    expect(r.fields["plate"]).toBe("HG-732-GH");
    expect(r.fields["or_number"]).toBeNull();
    expect((r.fields["lines"] as unknown[]).length).toBe(1);
  });

  it("fournisseur reconnu par sa structure mémorisée (sans nom exact)", () => {
    const f = purchaseRules(BL_FAURIE.replace("FAURIE AUTO SARLAT", "FAUR1E AUT0"), {
      suppliers: [{ name: "FAURIE AUTO SARLAT", header_tokens: ["route", "vitrac", "sarlat", "livraison"] }],
    });
    expect(f["supplier"]).toBe("FAURIE AUTO SARLAT");
  });

  it("document ambigu : IA texte seulement après échec des règles, vision seulement si texte insuffisant", async () => {
    const order: string[] = [];
    const d = deps({
      logLocal: vi.fn(async () => void order.push("rules")),
      aiText: vi.fn(async () => { order.push("text"); return { supplier: "X" }; }),
      aiVision: vi.fn(async () => { order.push("vision"); return { lines: [{ reference: "A1" }] }; }),
    });
    const text = "Document froissé illisible sans fournisseur ni lignes exploitables ".repeat(2);
    const r = await runDocPipeline({ kind: "purchase", text, hasImage: true, ctx: {} }, d);
    expect(order).toEqual(["text", "vision"]);
    expect(r.route).toBe("ai_vision_fallback");
    expect(r.fields["supplier"]).toBe("X");
  });

  it("repli texte suffisant : pas de vision", async () => {
    const d = deps({ aiText: vi.fn(async () => ({ merchant: "TOTAL", date: "2026-09-28", amount_ttc: 50 })) });
    const r = await runDocPipeline({ kind: "expense", text: "ticket mal lu ".repeat(10), hasImage: true }, d);
    expect(r.route).toBe("ai_text_fallback");
    expect(d.aiVision).not.toHaveBeenCalled();
  });

  it("réglage « repli IA » désactivé : aucun appel IA", async () => {
    const d = deps({ fallbackEnabled: vi.fn(async () => false) });
    const r = await runDocPipeline({ kind: "or_or_plate", text: "rien", hasImage: true }, d);
    expect(r.route).toBe("manual");
    expect(d.aiText).not.toHaveBeenCalled();
    expect(d.aiVision).not.toHaveBeenCalled();
  });
});

describe("règles déterministes", () => {
  it("ticket carburant", () => {
    const f = expenseRules("TOTAL ENERGIES\nSTATION A89\n28/09/2026 12:04\nGAZOLE 40,12 L\nTVA 20% 11,20\nTOTAL TTC 67,20 €");
    expect(f).toMatchObject({ merchant: "TOTAL ENERGIES", date: "2026-09-28", amount_ttc: 67.2, category: "carburant", vat_rate: 20 });
  });
  it("OR papier ou plaque", () => {
    expect(orOrPlateRules("ORDRE DE REPARATION N° 50890")).toMatchObject({ or_number: "50890" });
    expect(orOrPlateRules("HG-732-GH")).toMatchObject({ plate: "HG-732-GH", or_number: null });
    expect(orOrPlateRules("205/55 R16 91V")["plate"]).toBeNull();
  });
});
