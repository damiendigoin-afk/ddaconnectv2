import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Non-régression : les fragments parasites « d'accord », « à », « défaut »
 * observés sur Pixel 7 provenaient de la traduction automatique Chrome,
 * déclenchée par une page déclarée en anglais. La coquille doit rester en
 * français et interdire la traduction (qui casse aussi le rendu React).
 */
describe("Tour guidé — pas de traduction automatique du navigateur", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");

  it("déclare la page en français", () => {
    expect(root).toMatch(/<html lang="fr"/);
    expect(root).not.toMatch(/<html lang="en"/);
  });

  it("interdit explicitement la traduction", () => {
    expect(root).toMatch(/translate="no"/);
    expect(root).toMatch(/name: "google", content: "notranslate"/);
  });

  it("ne contient aucun libellé fragmenté « d'accord » dans l'UI du tour", () => {
    const files = [
      "src/components/StatusPicker.tsx",
      "src/components/PointCard.tsx",
      "src/components/MileageCard.tsx",
      "src/routes/tour.$tourId.index.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/d['’]accord/i);
    }
  });
});
