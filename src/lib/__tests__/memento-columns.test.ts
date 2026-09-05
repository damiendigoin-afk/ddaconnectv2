/**
 * Géométrie des colonnes du Mémento : les titres d'en-tête sont CENTRÉS, les
 * frontières réelles sont donc les milieux entre centres de titres voisins.
 * Couvre aussi les schémas à 5 colonnes, les tableaux multiples sur une même
 * page, le descriptif de section et l'invariant de page source.
 */
import { describe, expect, it } from "vitest";

import { emptyContext, parsePage, type PageText, type TextFragment } from "../packages-parse";

const OPTS = { kind: "renault_public" as const, fileName: "memento.pdf", version: "07/2026" };

type Cell = { str: string; x: number; width?: number };

function build(pdfPage: number, rows: Cell[][]): PageText {
  const fragments: TextFragment[] = [];
  rows.forEach((cells, i) => {
    const y = 800 - i * 14;
    cells.forEach((c) => fragments.push({ str: c.str, x: c.x, y, width: c.width }));
  });
  return { page: pdfPage, fragments };
}

/** En-tête page 248 : titres centrés (« code » commence à x=472). */
const HEADER_248: Cell[] = [
  { str: "véhicule", x: 60, width: 40 },
  { str: "motorisation", x: 260, width: 60 },
  { str: "code", x: 472, width: 20 },
  { str: "tarif", x: 540, width: 24 },
];

describe("frontières par centres de titres", () => {
  const out = parsePage(
    build(248, [
      [{ str: "forfaits avantage", x: 40 }],
      [{ str: "remplacement du silencieux", x: 40 }],
      [{ str: "ce forfait comprend :", x: 40 }],
      [{ str: "le remplacement du silencieux, la main-d'oeuvre.", x: 40 }],
      HEADER_248,
      [
        { str: "AUSTRAL / ESPACE VI / RAFALE", x: 60, width: 180 },
        { str: "1.2, 1.2 12V", x: 262, width: 60 },
        // Le code commence AVANT le x du mot « code » : il doit malgré tout
        // être classé en colonne code grâce aux frontières par centres.
        { str: "RXMNAO", x: 462, width: 40 },
        { str: "4289", x: 545, width: 24 },
      ],
    ]),
    { ...OPTS, context: emptyContext("07/2026"), pageCount: 249 },
  );
  const l = out.lines.find((x) => x.operation_code === "RXMNAO");

  it("classe le code dans la bonne colonne malgré le titre centré", () => {
    expect(l).toBeTruthy();
    expect(l?.engine).toBe("1.2, 1.2 12V");
    expect(l?.model).toBe("AUSTRAL / ESPACE VI / RAFALE");
    expect(l?.price_value).toBe(4289);
  });
  it("page source = index PDF réel", () => {
    expect(l?.source_page).toBe(248);
  });
  it("génération nulle sur plusieurs modèles", () => {
    expect(l?.generation).toBeNull();
  });
  it("descriptif de section complet, opération conservée", () => {
    expect(l?.operation_title).toBe("remplacement du silencieux");
    expect(l?.family).toBe("forfaits avantage");
    expect(l?.description).toBe(
      "ce forfait comprend : le remplacement du silencieux, la main-d'oeuvre.",
    );
  });
});

describe("deux tableaux différents sur la même page", () => {
  const out = parsePage(
    build(120, [
      [{ str: "remplacement du silencieux", x: 40 }],
      HEADER_248,
      [
        { str: "CLIO V", x: 60, width: 40 },
        { str: "1.0 12V", x: 262, width: 40 },
        { str: "RXMNA8", x: 462, width: 40 },
        { str: "506", x: 545, width: 20 },
      ],
      [{ str: "révision renault classique avec assistance", x: 40 }],
      [
        { str: "libellé", x: 60, width: 30 },
        { str: "norme", x: 240, width: 30 },
        { str: "huile", x: 340, width: 26 },
        { str: "code", x: 472, width: 20 },
        { str: "tarif", x: 540, width: 24 },
      ],
      [
        { str: "REV RENAULT CLASSIQUE", x: 60, width: 140 },
        { str: "RN 0700", x: 240, width: 40 },
        { str: "10W40", x: 340, width: 34 },
        { str: "RMPNJA", x: 462, width: 40 },
        { str: "255", x: 545, width: 20 },
      ],
    ]),
    { ...OPTS, context: emptyContext("07/2026"), pageCount: 249 },
  );

  it("le premier schéma reste véhicule", () => {
    const a = out.lines.find((x) => x.operation_code === "RXMNA8");
    expect(a?.model).toBe("CLIO V");
    expect(a?.price_value).toBe(506);
  });
  it("le second en-tête remplace le schéma : aucun modèle inventé", () => {
    const b = out.lines.find((x) => x.operation_code === "RMPNJA");
    expect(b?.model).toBeNull();
    expect(b?.price_value).toBe(255);
    expect(b?.label).toContain("REV RENAULT CLASSIQUE");
    expect(b?.operation_title).toBe("révision renault classique avec assistance");
  });
});

describe("schéma 5 colonnes véhicule / motorisation / batterie / code / tarif", () => {
  const out = parsePage(
    build(60, [
      [{ str: "remplacement de la batterie", x: 40 }],
      [
        { str: "véhicule", x: 60, width: 40 },
        { str: "motorisation", x: 240, width: 60 },
        { str: "batterie", x: 380, width: 40 },
        { str: "code", x: 472, width: 20 },
        { str: "tarif", x: 540, width: 24 },
      ],
      [
        { str: "CAPTUR I / QM3", x: 60, width: 90 },
        { str: "1.2 16V", x: 242, width: 40 },
        { str: "70AH", x: 382, width: 30 },
        { str: "RSPNCC", x: 462, width: 40 },
        { str: "389", x: 545, width: 20 },
      ],
    ]),
    { ...OPTS, context: emptyContext("07/2026"), pageCount: 249 },
  );
  const l = out.lines[0];

  it("code et prix propres, colonnes supplémentaires non polluantes", () => {
    expect(l?.operation_code).toBe("RSPNCC");
    expect(l?.price_value).toBe(389);
    expect(l?.model).toBe("CAPTUR I / QM3");
    expect(l?.engine).toBe("1.2 16V");
    expect(l?.engine).not.toContain("70AH");
  });
});

describe("continuation page suivante", () => {
  const p1 = parsePage(
    build(246, [
      [{ str: "forfaits avantage", x: 40 }],
      [{ str: "remplacement du silencieux", x: 40 }],
      [{ str: "ce forfait comprend :", x: 40 }],
      [{ str: "le remplacement du silencieux, la main-d'oeuvre.", x: 40 }],
      HEADER_248,
      [
        { str: "CLIO V", x: 60, width: 40 },
        { str: "1.0 12V", x: 262, width: 40 },
        { str: "RXMNA9", x: 462, width: 40 },
        { str: "583", x: 545, width: 20 },
      ],
    ]),
    { ...OPTS, context: emptyContext("07/2026"), pageCount: 249 },
  );

  const p2 = parsePage(
    build(247, [
      [
        { str: "MEGANE 4", x: 60, width: 50 },
        { str: "1.5 DCI", x: 262, width: 40 },
        { str: "RXMNB1", x: 462, width: 40 },
        { str: "612", x: 545, width: 20 },
      ],
    ]),
    { ...OPTS, context: p1.context, pageCount: 249 },
  );

  it("opération et descriptif conservés page suivante", () => {
    expect(p2.lines[0]?.operation_title).toBe("remplacement du silencieux");
    expect(p2.lines[0]?.description).toBe(p1.lines[0]?.description);
    expect(p2.lines[0]?.description).toContain("ce forfait comprend");
    expect(p2.lines[0]?.source_page).toBe(247);
  });
});

describe("invariant de page source", () => {
  it("rejette une page au-delà du nombre de pages du document", () => {
    const out = parsePage(
      build(250, [
        HEADER_248,
        [
          { str: "CLIO V", x: 60, width: 40 },
          { str: "1.0 12V", x: 262, width: 40 },
          { str: "RXMNZZ", x: 462, width: 40 },
          { str: "100", x: 545, width: 20 },
        ],
      ]),
      { ...OPTS, context: emptyContext("07/2026"), pageCount: 249 },
    );
    expect(out.lines).toHaveLength(0);
    expect(out.uncertain.join(" ")).toContain("hors document");
  });
});
