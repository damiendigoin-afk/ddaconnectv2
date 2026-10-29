import { describe, it, expect } from "vitest";
import { expenseRevisionTargets, expenseDeliveryKey, revisionMailKind, canRetryExpenseDelivery, requiresAccountingInstruction, EXPENSE_EDIT_FIELDS } from "../expense-revision-rules";

describe("Corrections comptables versionnées", () => {
  it("jamais envoyée : annulation ne crée aucun destinataire", () => expect(expenseRevisionTargets(true, "compta@garagecastillon.fr", new Map())).toEqual([]));
  it("déplacement inter-entités : annulation ancienne boîte et une seule nouvelle transmission", () => {
    expect(expenseRevisionTargets(false, "compta@garagecastillon.fr", new Map([["compta@dda-lalinde.fr", 1]]))).toEqual([
      { recipient: "compta@dda-lalinde.fr", target_revision: 1, kind: "cancel" },
      { recipient: "compta@garagecastillon.fr", target_revision: 0, kind: "initial" },
    ]);
  });
  it("changement Lalinde vers Castillon : annuler côté ancien établissement", () => {
    expect(revisionMailKind(false, "compta@dda-lalinde.fr", "compta@garagecastillon.fr")).toBe("cancel");
  });
  it("même établissement : remplacer l'ancienne version", () => {
    expect(revisionMailKind(false, "compta@dda-lalinde.fr", "compta@dda-lalinde.fr")).toBe("replace");
  });
  it("premier envoi sans annulation inutile", () => {
    expect(revisionMailKind(false, null, "compta@garagecastillon.fr")).toBe("initial");
  });
  it("annulation ciblée", () => expect(revisionMailKind(true, "compta@dda-lalinde.fr", "compta@dda-lalinde.fr")).toBe("cancel"));
  it("clé stable sur réessai et distincte par version / boîte / action", () => {
    const key = expenseDeliveryKey("note", 2, "compta@dda-lalinde.fr", "replace");
    expect(key).toBe(expenseDeliveryKey("note", 2, "compta@dda-lalinde.fr", "replace"));
    expect(key).not.toBe(expenseDeliveryKey("note", 3, "compta@dda-lalinde.fr", "replace"));
    expect(key).not.toBe(expenseDeliveryKey("note", 2, "compta@garagecastillon.fr", "replace"));
  });
  it.each(["unknown", "sending", "sent"])("%s bloque le double envoi", state => expect(canRetryExpenseDelivery(state)).toBe(false));
  it.each(["ready", "failed"])("%s autorise une tentative contrôlée", state => expect(canRetryExpenseDelivery(state)).toBe(true));
  it.each(["accounted_at", "reconciled_at", "settled_at", "exported_at"])("%s impose traitement comptable explicite", field => expect(requiresAccountingInstruction({ [field]: "2026-10-12" })).toBe(true));
  it("jamais comptabilisée n'impose pas d'extourne", () => expect(requiresAccountingInstruction({})).toBe(false));
  it("identifiant permanent / validation ne sont jamais des champs modifiables", () => {
    expect(EXPENSE_EDIT_FIELDS).not.toContain("id"); expect(EXPENSE_EDIT_FIELDS).not.toContain("validated_at");
    expect(EXPENSE_EDIT_FIELDS).toContain("site_id"); expect(EXPENSE_EDIT_FIELDS).toContain("receipt_path");
  });
});