/**
 * Structures réelles du mémento : le schéma de colonnes est déduit de la ligne
 * d'en-tête et conservé de page en page. Aucun modèle véhicule n'est inventé
 * sur un tableau de révisions.
 */
import { describe, expect, it } from "vitest";

import {
  detectTableSchema,
  emptyContext,
  parseDocument,
  parsePage,
  titleKind,
  type PageText,
} from "../packages-parse";

/** Construit une page texte à partir de lignes, de haut en bas. */
function page(n: number, rows: string[]): PageText {
  return {
    page: n,
    fragments: rows.map((str, i) => ({ str, x: 0, y: 800 - i * 12 })),
  };
}

const OPTS = { kind: "renault_public" as const, fileName: "memento.pdf", version: "01/2026" };

const PAGE_248 = [
  "forfaits avantage",
  "remplacement du silencieux",
  "ce forfait comprend :",
  "le remplacement du silencieux, la main-d'œuvre.",
  "véhicule motorisation code tarif",
  "CAPTUR II EUROPE / SYMBIOZ 1.8 RXMNAK 1739",
  "AUSTRAL / ESPACE VI / RAFALE 1.2, 1.2 12V RXMNAO 4289",
];

const PAGE_5 = [
  "révision",
  "parc actuel",
  "révision renault classique avec assistance",
  "ce forfait comprend :",
  "la vidange, le filtre à huile, les contrôles, ...",
  "libellé norme huile code tarif",
  "REV RENAULT CLASSIQUE RN 0700 10W40 RMPNJA 255",
  "REV RENAULT CLASSIQUE 6 LITRES RN 17 05W30 RMPNJG 279",
];

describe("reconnaissance du schéma de tableau", () => {
  it("en-tête véhicule / motorisation / code / tarif", () => {
    expect(detectTableSchema("véhicule motorisation code tarif")).toMatchObject({ hasVehicle: true });
  });
  it("en-tête libellé / norme / huile / code / tarif : pas de colonne véhicule", () => {
    expect(detectTableSchema("libellé norme huile code tarif")).toMatchObject({
      hasVehicle: false,
      hasLabel: true,
    });
  });
  it("en-têtes courts", () => {
    expect(detectTableSchema("véhicule code tarif")).toMatchObject({ hasVehicle: true });
    expect(detectTableSchema("libellé code prix")).toMatchObject({ hasVehicle: false });
  });
  it("une ligne de données n'est pas un en-tête", () => {
    expect(detectTableSchema("CAPTUR II EUROPE / SYMBIOZ 1.8 RXMNAK 1739")).toBeNull();
  });
});

describe("détection des titres", () => {
  it("accepte une rubrique courte sans ponctuation descriptive", () => {
    expect(titleKind("remplacement du silencieux")).toBe("operation");
    expect(titleKind("révision renault classique avec assistance")).toBe("operation");
    expect(titleKind("forfaits avantage")).toBe("famille");
  });
  it("refuse le contenu, les phrases et les en-têtes", () => {
    expect(titleKind("ce forfait comprend :")).toBeNull();
    expect(titleKind("le remplacement du silencieux, la main-d'œuvre.")).toBeNull();
    expect(titleKind("la vidange, le filtre à huile, les contrôles, ...")).toBeNull();
    expect(titleKind("véhicule motorisation code tarif")).toBeNull();
    expect(titleKind("libellé norme huile code tarif")).toBeNull();
    expect(titleKind("véhicule de remplacement")).toBeNull();
    expect(titleKind("tarifs zone 2")).toBeNull();
    expect(titleKind("page 248")).toBeNull();
  });
});

describe("page 248 — tableau véhicule / motorisation", () => {
  const out = parsePage(page(248, PAGE_248), { ...OPTS, context: emptyContext("01/2026") });
  const l = out.lines.find((x) => x.operation_code === "RXMNAK");

  it("sépare modèle, motorisation, code et prix", () => {
    expect(l).toBeTruthy();
    expect(l?.model).toBe("CAPTUR II EUROPE / SYMBIOZ");
    expect(l?.engine).toBe("1.8");
    expect(l?.price_value).toBe(1739);
    expect(l?.source_page).toBe(248);
  });
  it("conserve le titre d'opération et la famille de la section", () => {
    expect(l?.operation_title).toBe("remplacement du silencieux");
    expect(l?.family).toBe("forfaits avantage");
  });
  it("lit la deuxième ligne du même tableau", () => {
    const b = out.lines.find((x) => x.operation_code === "RXMNAO");
    expect(b?.price_value).toBe(4289);
    expect(b?.operation_title).toBe("remplacement du silencieux");
  });
});

describe("page 5 — tableau révisions (libellé / norme / huile)", () => {
  const out = parsePage(page(5, PAGE_5), { ...OPTS, context: emptyContext("01/2026") });
  const a = out.lines.find((x) => x.operation_code === "RMPNJA");
  const b = out.lines.find((x) => x.operation_code === "RMPNJG");

  it("code et prix corrects", () => {
    expect(a?.price_value).toBe(255);
    expect(b?.price_value).toBe(279);
  });
  it("aucun modèle véhicule inventé", () => {
    expect(a?.model).toBeNull();
    expect(b?.model).toBeNull();
    expect(a?.generation).toBeNull();
  });
  it("le libellé de ligne sert de label précis", () => {
    expect(a?.label).toContain("REV RENAULT CLASSIQUE");
  });
  it("le titre d'opération de section est conservé", () => {
    expect(a?.operation_title).toBe("révision renault classique avec assistance");
    expect(a?.operation_title).not.toContain("comprend");
    expect(a?.operation_title).not.toContain("libellé");
  });
});

describe("contexte multi-pages et reprise", () => {
  it("le tableau qui continue page suivante garde titre et schéma", () => {
    const doc = parseDocument(
      [page(5, PAGE_5), page(6, ["REV RENAULT CLASSIQUE RN 0720 5W30 RMPNJK 299"])],
      OPTS,
    );
    const next = doc.lines.find((x) => x.operation_code === "RMPNJK");
    expect(next?.operation_title).toBe("révision renault classique avec assistance");
    expect(next?.model).toBeNull();
    expect(next?.price_value).toBe(299);
  });

  it("reprise après interruption : le contexte enregistré restitue l'opération", () => {
    const first = parseDocument([page(248, PAGE_248)], OPTS);
    // Simule l'enregistrement puis la relecture du contexte (JSON en base).
    const saved = JSON.parse(JSON.stringify(first.context));
    const resumed = parseDocument(
      [page(249, ["MEGANE IV 1.5 dCi RXMNAP 1899"])],
      { ...OPTS, context: saved },
    );
    const l = resumed.lines[0];
    expect(l?.operation_title).toBe("remplacement du silencieux");
    expect(l?.family).toBe("forfaits avantage");
    expect(l?.model).toBe("MEGANE IV");
    expect(l?.price_value).toBe(1899);
  });

  it("sans contexte restauré, l'opération serait perdue (garde-fou du test)", () => {
    const cold = parseDocument([page(249, ["MEGANE IV 1.5 dCi RXMNAP 1899"])], OPTS);
    expect(cold.lines[0]?.operation_title).toBeNull();
  });
});
