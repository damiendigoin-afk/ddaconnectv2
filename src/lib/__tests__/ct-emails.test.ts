import { describe, expect, it } from "vitest";

import { ctSummaryLabel, CT_MISSING, mergeCtComment } from "@/lib/ct";
import { findPlates, matchEmailRule, type EmailRule } from "@/lib/emails-core";

describe("contrôle technique", () => {
  it("injecte la phrase automatique", () => {
    expect(mergeCtComment("", "2027-04-15")).toBe("Contrôle technique valable jusqu'au 15/04/2027.");
  });

  it("ne duplique pas la phrase après correction et garde le commentaire manuel", () => {
    const first = mergeCtComment("Vignette peu lisible.", "2027-04-15");
    const second = mergeCtComment(first, "2027-05-20");
    expect(second.split("Contrôle technique valable").length - 1).toBe(1);
    expect(second).toContain("Vignette peu lisible.");
    expect(second).toContain("20/05/2027");
  });

  it("gère la seconde échéance pollution des VU", () => {
    const c = mergeCtComment("", "2027-04-15", "2026-10-01");
    expect(c).toContain("Contrôle complémentaire pollution à effectuer avant le 01/10/2026.");
  });

  it("affiche un libellé explicite sans date", () => {
    expect(ctSummaryLabel(null)).toBe(CT_MISSING);
    expect(mergeCtComment("Note", null)).toBe(`Note\n${CT_MISSING}`);
  });
});

describe("flux e-mails sans IA", () => {
  it("détecte une immatriculation dans l'objet", () => {
    expect(findPlates("Devis pour FT-346-QS merci")).toContain("FT346QS");
    expect(findPlates("ancien format 1234 AB 24")).toContain("1234AB24");
  });

  it("ne détecte rien dans un objet publicitaire sans plaque", () => {
    expect(findPlates("Berlingo VN EAT8 HDI 130 CV")).toEqual([]);
  });

  it("applique la règle expéditeur en priorité", () => {
    const rules: EmailRule[] = [
      { id: "1", match_type: "domain", match_value: "pub.fr", category: "autre" },
      { id: "2", match_type: "sender", match_value: "vendeur@pub.fr", category: "publicite" },
    ];
    expect(matchEmailRule(rules, { from: "vendeur@pub.fr", subject: "Berlingo VN" })?.category).toBe("publicite");
    expect(matchEmailRule(rules, { from: "autre@pub.fr", subject: "x" })?.category).toBe("autre");
    expect(matchEmailRule(rules, { from: "x@ailleurs.fr", subject: "x" })).toBeNull();
  });
});
