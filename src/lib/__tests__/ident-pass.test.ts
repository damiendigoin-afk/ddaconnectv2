import { describe, expect, it } from "vitest";
import { mergeIdentifierPass, needsIdentifierPass, normalizePurchaseExtract, parseIdentifierPass } from "@/lib/purchase-extract";

describe("second passage identifiants — BL FAURIE 914776", () => {
  it("Mes références HG 732 GH manqué au 1er passage → plate HG-732-GH, or null", () => {
    const first = normalizePurchaseExtract({ doc_kind: "bl", supplier: "FAURIE AUTO SARLAT", delivery_note_number: "914776", plate: null, or_number: null, lines: [{ reference: "7701208174", label: "FILTRE", quantity: 1 }] });
    expect(first.plate).toBeNull();
    expect(needsIdentifierPass(first)).toBe(true);
    const out = mergeIdentifierPass(first, parseIdentifierPass({ plate: "HG 732 GH", or_number: null, evidence: "Mes références : HG 732 GH" }));
    expect(out.plate).toBe("HG-732-GH");
    expect(out.or_number).toBeNull();
    expect(out.delivery_note_number).toBe("914776");
  });
  it("immat renvoyée dans or_number → plaque, jamais OR", () => {
    for (const v of ["HG732GH", "hg-732-gh", "HG.732.GH"]) {
      const p = parseIdentifierPass({ or_number: v });
      expect(p.plate).toBe("HG-732-GH");
      expect(p.or_number).toBeNull();
    }
  });
  it("5 chiffres seuls restent un OR", () => {
    expect(parseIdentifierPass({ or_number: "50413" }).or_number).toBe("50413");
  });
  it("dimension pneu jamais plaque", () => {
    const p = parseIdentifierPass({ plate: "155/65 R14 75T", or_number: "205/55R16" });
    expect(p.plate).toBeNull();
    expect(p.or_number).toBeNull();
  });
  it("n'écrase jamais une valeur sûre ni ne prend le n° BL comme OR", () => {
    const first = { plate: "AB-123-CD", or_number: "48416", order_reference: null, delivery_note_number: "914776" };
    const out = mergeIdentifierPass(first, parseIdentifierPass({ plate: "HG 732 GH", or_number: "50413" }));
    expect(out.plate).toBe("AB-123-CD");
    expect(out.or_number).toBe("48416");
    const out2 = mergeIdentifierPass({ plate: null, or_number: null, order_reference: null, delivery_note_number: "914776" }, parseIdentifierPass({ or_number: "914776" }));
    expect(out2.or_number).toBeNull();
  });
});
