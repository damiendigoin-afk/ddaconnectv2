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

describe("archivage et règlement en compte", () => {
  it("archive sans perdre la donnée puis restaure", () => {
    const arch = expenseTransition("archive", "2026-01-05T10:00:00.000Z", "Manager");
    expect(arch["archived_at"]).toBe("2026-01-05T10:00:00.000Z");
    expect(arch["status"]).toBeUndefined();
    const back = expenseTransition("restore", "2026-01-06T10:00:00.000Z", "Manager");
    expect(back["archived_at"]).toBeNull();
  });

  it("n'autorise la suppression définitive que sur les notes non finalisées", () => {
    expect(canDeleteExpense("brouillon")).toBe(true);
    expect(canDeleteExpense("soumis")).toBe(true);
    expect(canDeleteExpense("refuse")).toBe(true);
    for (const s of ["valide", "transmise", "reglee", "comptabilisee"]) expect(canDeleteExpense(s)).toBe(false);
  });

  it("traite « en compte » comme une dépense sans remboursement à rapprocher", () => {
    expect(isPersonalPayment("en_compte")).toBe(false);
    expect(isAccountPayment("en_compte")).toBe(true);
    expect(paymentLabel("en_compte")).toBe("En compte");
    expect(accountLabel("carrefour_atelier")).toBe("Carrefour — Atelier");
    expect(accountLabel("autre", "Station Avia")).toBe("Station Avia");
  });

  it("rapproche une note en compte en la comptabilisant", () => {
    const p = expenseTransition("reconcile", "2026-02-01T09:00:00.000Z", "Compta");
    expect(p["status"]).toBe("comptabilisee");
    expect(p["reconciled_at"]).toBe("2026-02-01T09:00:00.000Z");
    expect(p["reconciled_by_name"]).toBe("Compta");
  });
});
