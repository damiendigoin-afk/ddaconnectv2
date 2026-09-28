import { describe, expect, it } from "vitest";
import { plateAfterOrderPick } from "@/lib/plate";

describe("immat conservée après sélection d'une commande", () => {
  it("document HG-732-GH + commande simplifiée sans plate => reste HG-732-GH", () => {
    expect(plateAfterOrderPick("HG-732-GH", "HG-732-GH", null, false)).toBe("HG-732-GH");
    expect(plateAfterOrderPick("", "hg 732 gh", null, false)).toBe("HG-732-GH");
  });
  it("commande avec immat utilisée seulement si champ vide", () => {
    expect(plateAfterOrderPick("", null, "ab123cd", false)).toBe("AB-123-CD");
    expect(plateAfterOrderPick("HG732GH", "HG-732-GH", "AB-123-CD", false)).toBe("HG-732-GH");
  });
  it("saisie utilisateur préservée", () => {
    expect(plateAfterOrderPick("ab 123 cd", "HG-732-GH", "EF-456-GH", true)).toBe("AB-123-CD");
  });
});
