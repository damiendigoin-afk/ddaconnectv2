import { describe, expect, it } from "vitest";

import { expenseTransition, guessCategory, isPersonalPayment, paymentLabel, accountingEmailFor } from "../expenses";

describe("workflow notes de frais", () => {
  it("distingue remboursement salarié et règlement professionnel", () => {
    expect(isPersonalPayment("perso")).toBe(true);
    expect(isPersonalPayment("pro_cb")).toBe(false);
    expect(paymentLabel("pro_virement")).toContain("Virement");
  });

  it("propose un motif déterministe sans bloquer la saisie", () => {
    expect(guessCategory("TOTALENERGIES GAZOLE B7")).toBe("carburant");
    expect(guessCategory("VINCI AUTOROUTES PEAGE")).toBe("peage");
    expect(guessCategory("texte sans catégorie fiable")).toBeNull();
  });

  it("produit des transitions distinctes pour remboursement et comptabilisation", () => {
    const now = "2026-09-07T12:30:00.000Z";
    expect(expenseTransition("settle", now, "Compta", "2026-09-08")).toMatchObject({
      status: "reglee",
      settled_at: "2026-09-08",
      employee_notified_at: null,
    });
    expect(expenseTransition("account", now, "Compta")).toMatchObject({
      status: "comptabilisee",
      accounted_at: now,
      employee_notified_at: null,
    });
  });

  it("route la comptabilité sur les codes de site réels, avec repli par libellé", () => {
    expect(accountingEmailFor("dda", "Damien Digoin Automobile")).toBe("compta@dda-lalinde.fr");
    expect(accountingEmailFor("castillon", "Castillon")).toBe("compta@garagecastillon.fr");
    expect(accountingEmailFor("", "Garage de St-Cyprien")).toBe("compta@garagecastillon.fr");
    expect(accountingEmailFor("", "Site inconnu")).toBe("");
  });
});
