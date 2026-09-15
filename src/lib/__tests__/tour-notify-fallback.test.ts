import { describe, expect, it } from "vitest";

import { frontOfficeIdempotencyKey, normalizeFrontOfficeRecipients } from "../tour-notify-core";

/**
 * Le filet de sécurité de la clôture réutilise exactement les mêmes règles que
 * le service complet : mêmes destinataires normalisés, même clé d'idempotence.
 * Un envoi de secours ne peut donc jamais produire de doublon.
 */
describe("notification de secours de fin de tour", () => {
  it("réutilise la clé d'idempotence automatique du service complet", () => {
    const args = {
      inspectionId: "11111111-1111-1111-1111-111111111111",
      recipient: "Contact@Garagecastillon.FR",
      mode: "automatic" as const,
    };
    expect(frontOfficeIdempotencyKey(args)).toBe(
      frontOfficeIdempotencyKey({ ...args, recipient: "contact@garagecastillon.fr" }),
    );
  });

  it("normalise et dédoublonne les destinataires paramétrés", () => {
    expect(
      normalizeFrontOfficeRecipients([
        { email: " Contact@Garagecastillon.fr " },
        { email: "contact@garagecastillon.fr" },
        { email: "" },
        {},
      ]),
    ).toEqual(["contact@garagecastillon.fr"]);
  });

  it("ne propose aucune adresse par défaut lorsqu'aucun destinataire n'est paramétré", () => {
    expect(normalizeFrontOfficeRecipients([])).toEqual([]);
  });

  it("expose un module de secours sans dépendance PDF", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/tour-notify-fallback.server.ts", "utf8"),
    );
    expect(source).not.toContain("pdf-lib");
    expect(source).not.toContain("tour-pdf.server");
    expect(source).toContain("tour_notification_recipients");
  });
});
