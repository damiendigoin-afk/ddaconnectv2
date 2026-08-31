import { describe, expect, it } from "vitest";

import {
  acceptedProviderSend,
  aggregateFrontOfficeResults,
  assertUsablePdf,
  emailLogOutcome,
  frontOfficeIdempotencyKey,
  normalizeFrontOfficeRecipients,
} from "@/lib/tour-notify-core";

describe("notification Front Office", () => {
  it("résout et dédoublonne les destinataires configurés", () => {
    expect(
      normalizeFrontOfficeRecipients([
        { email: " Accueil@Garage.fr " },
        { email: "accueil@garage.fr" },
        { email: "atelier@garage.fr" },
        { email: null },
      ]),
    ).toEqual(["accueil@garage.fr", "atelier@garage.fr"]);
  });

  it("garde une clé stable à la clôture et distingue chaque relance manuelle", () => {
    const automatic = frontOfficeIdempotencyKey({
      inspectionId: "tour-1",
      recipient: "front@garage.fr",
      mode: "automatic",
    });
    expect(
      frontOfficeIdempotencyKey({
        inspectionId: "tour-1",
        recipient: "FRONT@garage.fr",
        mode: "automatic",
      }),
    ).toBe(automatic);
    expect(
      frontOfficeIdempotencyKey({
        inspectionId: "tour-1",
        recipient: "front@garage.fr",
        mode: "manual",
        attemptId: "attempt-2",
      }),
    ).not.toBe(automatic);
  });

  it("exige un vrai PDF avant envoi", () => {
    expect(() => assertUsablePdf("")).toThrow(/PDF/);
    expect(() => assertUsablePdf("JVBERi0" + "A".repeat(120))).not.toThrow();
  });

  it("ne marque envoyé que si le fournisseur renvoie un identifiant", () => {
    expect(acceptedProviderSend({ ok: true })).toBe(false);
    expect(emailLogOutcome({ ok: true })).toEqual({
      status: "failed",
      provider_id: null,
      error_message: "Le fournisseur n'a pas confirmé l'envoi",
    });
    expect(emailLogOutcome({ ok: true, id: "provider-123" })).toEqual({
      status: "sent",
      provider_id: "provider-123",
      error_message: null,
    });
  });

  it("journalise le refus fournisseur et agrège les résultats honnêtement", () => {
    const failure = { ok: false, error: "Adresse refusée" };
    expect(emailLogOutcome(failure).status).toBe("failed");
    expect(emailLogOutcome(failure).error_message).toBe("Adresse refusée");
    expect(aggregateFrontOfficeResults([{ ok: true, id: "one" }, failure])).toBe("partial");
    expect(aggregateFrontOfficeResults([failure])).toBe("failed");
    expect(aggregateFrontOfficeResults([{ ok: true, id: "one" }])).toBe("sent");
  });
});