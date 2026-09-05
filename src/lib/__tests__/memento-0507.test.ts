/**
 * Correctifs issus d'un import réel « Renault Public Zone C 07/2026 » (249 pages
 * imprimées) : colonnes du tableau, motorisation complète, génération non
 * ambiguë, page source imprimée, garde-fou de persistance et remplacement
 * propre d'un réimport de la même version.
 */
import { describe, expect, it } from "vitest";

import {
  detectPrintedPage,
  emptyContext,
  parsePage,
  type PageText,
  type TextFragment,
} from "../packages-parse";
import { isForbiddenLabel } from "../packages-guard";
import { isStaleAfterRun, sanitizeLines, type DetectedLine } from "../packages-import";

const X = { vehicle: 40, engine: 260, code: 420, price: 500 };

/** Construit une page à colonnes réelles (positions X issues de l'en-tête). */
function columnPage(pdfIndex: number, rows: [string, string, string, string][], footer?: string): PageText {
  const fragments: TextFragment[] = [
    { str: "véhicule", x: X.vehicle, y: 800 },
    { str: "motorisation", x: X.engine, y: 800 },
    { str: "code", x: X.code, y: 800 },
    { str: "tarif", x: X.price, y: 800 },
  ];
  rows.forEach(([veh, eng, code, price], i) => {
    const y = 780 - i * 14;
    if (veh) fragments.push({ str: veh, x: X.vehicle, y });
    if (eng) fragments.push({ str: eng, x: X.engine, y });
    if (code) fragments.push({ str: code, x: X.code, y });
    if (price) fragments.push({ str: price, x: X.price, y });
  });
  if (footer) fragments.push({ str: footer, x: X.vehicle, y: 40 });
  return { page: pdfIndex, fragments };
}

const OPTS = { kind: "renault_public" as const, fileName: "memento.pdf", version: "07/2026" };

const ctx = () => {
  const c = emptyContext("07/2026");
  c.family = "forfaits avantage";
  c.operation = "remplacement du silencieux";
  return c;
};

describe("page 248 imprimée (index pdfjs 252)", () => {
  // Le PDF contient des pages techniques : l'index pdfjs dépasse le numéro
  // imprimé. C'est la cause exacte des « p.252 / p.264 » observés en base.
  const out = parsePage(
    columnPage(
      252,
      [
        ["AUSTRAL / ESPACE VI / RAFALE", "1.2, 1.2 12V", "RXMNAO", "4289"],
        ["MEGANE 4", "1.5 DCI", "RXMNAP", "1899"],
      ],
      "248/249",
    ),
    { ...OPTS, context: ctx(), pageCount: 260 },
  );
  const l = out.lines.find((x) => x.operation_code === "RXMNAO");

  it("sépare modèle, motorisation complète, code et prix", () => {
    expect(l?.model).toBe("AUSTRAL / ESPACE VI / RAFALE");
    expect(l?.engine).toBe("1.2, 1.2 12V");
    expect(l?.price_value).toBe(4289);
  });
  it("conserve le titre d'opération métier", () => {
    expect(l?.operation_title).toBe("remplacement du silencieux");
    expect(l?.label).toBe("remplacement du silencieux");
    expect(l?.family).toBe("forfaits avantage");
  });
  it("page source = numéro imprimé du document", () => {
    expect(l?.source_page).toBe(248);
    expect(detectPrintedPage(["248/249"])).toEqual({ page: 248, total: 249 });
  });
  it("plusieurs modèles séparés par « / » : aucune génération globale", () => {
    expect(l?.generation).toBeNull();
  });
  it("n'emprunte pas la motorisation de la ligne voisine", () => {
    const b = out.lines.find((x) => x.operation_code === "RXMNAP");
    expect(b?.engine).toBe("1.5 DCI");
    expect(b?.model).toBe("MEGANE 4");
  });
});

describe("cellule motorisation sur plusieurs lignes (RFMNBD)", () => {
  const out = parsePage(
    columnPage(
      234,
      [
        ["AUSTRAL / ESPACE VI / RAFALE", "1.2, 1.2 12V,", "", ""],
        ["", "1.3 16V", "RFMNBD", "59"],
        ["SCENIC 4", "2.0 DCI", "RFMNBE", "72"],
      ],
      "230/249",
    ),
    { ...OPTS, context: ctx(), pageCount: 260 },
  );

  it("accumule toute la cellule motorisation jusqu'au code + tarif", () => {
    const l = out.lines.find((x) => x.operation_code === "RFMNBD");
    expect(l?.engine).toBe("1.2, 1.2 12V, 1.3 16V");
    expect(l?.model).toBe("AUSTRAL / ESPACE VI / RAFALE");
    expect(l?.price_value).toBe(59);
    expect(l?.source_page).toBe(230);
    expect(l?.engine).not.toContain("2.0 DCI");
  });
  it("la ligne suivante garde sa propre cellule", () => {
    const n = out.lines.find((x) => x.operation_code === "RFMNBE");
    expect(n?.engine).toBe("2.0 DCI");
    expect(n?.model).toBe("SCENIC 4");
  });
});

describe("garde-fou de persistance", () => {
  it("un en-tête ou une ligne de contenu ne peut jamais servir de libellé", () => {
    expect(isForbiddenLabel("véhicule motorisation code tarif")).toBe(true);
    expect(isForbiddenLabel("libellé norme huile code tarif")).toBe(true);
    expect(isForbiddenLabel("ce forfait comprend :")).toBe(true);
    expect(isForbiddenLabel("tarifs zone 2")).toBe(true);
    expect(isForbiddenLabel("page 248/249")).toBe(true);
    expect(isForbiddenLabel("remplacement du silencieux")).toBe(false);
  });

  const line = (over: Partial<DetectedLine>): DetectedLine => ({
    source_kind: "renault_public",
    source_file_name: "memento.pdf",
    source_version: "07/2026",
    source_page: 248,
    brand: "Renault",
    model: null,
    segment: null,
    energies: [],
    operation_code: "RXMNAO",
    label: "remplacement du silencieux",
    price_value: 4289,
    price_basis: "ttc",
    hours: null,
    parts_ht: null,
    year_from: null,
    year_to: null,
    notes: null,
    ...over,
  });

  it("écarte une ligne dont le libellé est un en-tête", () => {
    const out = sanitizeLines([line({ label: "véhicule motorisation code tarif" })]);
    expect(out.lines).toHaveLength(0);
    expect(out.warnings[0]).toContain("RXMNAO");
  });
  it("neutralise un titre d'opération ou une famille interdits", () => {
    const out = sanitizeLines([
      line({ operation_title: "véhicule motorisation code tarif", family: "ce forfait comprend :" }),
    ]);
    expect(out.lines[0]?.operation_title).toBeNull();
    expect(out.lines[0]?.family).toBeNull();
  });
  it("refuse une page source hors du document", () => {
    const out = sanitizeLines([line({ source_page: 252 })], { pageCount: 249 });
    expect(out.lines).toHaveLength(0);
    expect(out.warnings[0]).toContain("252");
    expect(sanitizeLines([line({ source_page: 248 })], { pageCount: 249 }).lines).toHaveLength(1);
  });
});

describe("réimport de la même version", () => {
  const run = { sourceKind: "renault_public" as const, version: "07/2026", importId: "run-B" };
  const row = (over: Record<string, unknown>) => ({
    source_kind: "renault_public",
    source_version: "07/2026",
    active: true,
    import_id: "run-A",
    ...over,
  });

  it("expire les lignes du run précédent non retouchées", () => {
    expect(isStaleAfterRun(row({}), run)).toBe(true);
  });
  it("conserve les lignes touchées par le run courant", () => {
    expect(isStaleAfterRun(row({ import_id: "run-B" }), run)).toBe(false);
  });
  it("ne touche ni les autres versions, ni les autres référentiels, ni le manuel", () => {
    expect(isStaleAfterRun(row({ source_version: "01/2026" }), run)).toBe(false);
    expect(isStaleAfterRun(row({ source_kind: "dacia_public" }), run)).toBe(false);
    expect(isStaleAfterRun(row({ source_kind: null, import_id: null }), run)).toBe(false);
  });
  it("aucun nettoyage sans import complet identifié", () => {
    expect(isStaleAfterRun(row({}), { ...run, importId: null })).toBe(false);
  });
});
