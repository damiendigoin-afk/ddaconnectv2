import { describe, expect, it } from "vitest";
import { checkCtSave, ctProvenance, ctSaveSource, isPhotoDataUrl, sameDayMonthAsToday } from "../ct-ocr";

const tdv = new Date("2026-11-16T15:00:00Z");

describe("CT — décision d'enregistrement", () => {
  it("les 5 dates du 16/11 au jour/mois du TDV déclenchent un avertissement, jamais un enregistrement muet", () => {
    for (const d of ["2026-11-16", "2026-11-16", "2026-11-16", "2028-11-16", "2029-11-16"]) {
      const c = checkCtSave({ finalCt: d, today: tdv });
      expect(c.ok && c.warnings.some((w) => w.includes("aujourd’hui"))).toBe(true);
    }
    expect(sameDayMonthAsToday("2028-06-08", tdv)).toBe(false);
  });
  it("08/06/2028 proposé puis 16/11/2026 saisi : écart signalé et source « date corrigée »", () => {
    const c = checkCtSave({ finalCt: "2026-11-16", ocrCt: "2028-06-08", today: tdv });
    expect(c.ok && c.warnings.length).toBe(2);
    expect(ctSaveSource({ finalCt: "2026-11-16", ocrCt: "2028-06-08" })).toBe("date_corrigee");
    expect(ctSaveSource({ finalCt: "2028-06-08", ocrCt: "2028-06-08" })).toBe("ocr_confirme");
  });
  it("date déjà connue confirmée sans lecture = préexistante confirmée ; date incomplète refusée", () => {
    expect(ctSaveSource({ finalCt: "2027-06-30", existingCt: "2027-06-30" })).toBe("preexistante_confirmee");
    expect(checkCtSave({ finalCt: "2027-06", today: tdv }).ok).toBe(false);
    expect(checkCtSave({ finalCt: "", today: tdv }).ok).toBe(false);
    expect(checkCtSave({ finalCt: "2028-06-08", ocrCt: "2028-06-08", today: tdv })).toEqual({ ok: true, warnings: [] });
  });
  it("provenance : photo = vision, échec explicite, aucun texte personnel", () => {
    expect(isPhotoDataUrl("data:image/jpeg;base64,xx")).toBe(true);
    expect(isPhotoDataUrl("data:application/pdf;base64,xx")).toBe(false);
    expect(ctProvenance({ ok: true, route: "ai_vision_fallback", visionFirst: true, aiCalls: 1, parsed: { ct_due_date: "2028-06-08", confidence: 0.8 } }))
      .toEqual({ path: "vision_photo", route: "ai_vision_fallback", vision_first: true, ai_calls: 1, has_ct_date: true, confidence: 0.8 });
    expect(ctProvenance({ ok: true, route: "manual", visionFailed: true, parsed: {} }).path).toBe("echec");
    expect(ctProvenance({ ok: true, route: "ai_text_fallback", parsed: { ct_due_date: "2028-06-08" } }).path).toBe("ia_texte");
  });
});
