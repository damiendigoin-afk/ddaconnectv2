import { describe, expect, it } from "vitest";

import {
  dedupeKey,
  hasChanged,
  linesFromAi,
  linesFromRows,
  parseEnergies,
  rowFromLine,
  toPrices,
  type DetectedLine,
} from "../packages-import";

const ctxPublic = {
  source_kind: "renault_public" as const,
  source_file_name: "memento.csv",
  source_version: "01/2026",
};

describe("conversion des prix selon la convention du mémento", () => {
  it("mémento public : prix TTC conservé, HT déduit une seule fois", () => {
    expect(toPrices(120, "ttc")).toEqual({ price_ht: 100, price_ttc: 120 });
  });
  it("mémento Pro/LLD : prix HT conservé, TTC calculé sans double TVA", () => {
    expect(toPrices(100, "ht")).toEqual({ price_ht: 100, price_ttc: 120 });
  });
  it("prix absent : aucune valeur inventée", () => {
    expect(toPrices(null, "ttc")).toEqual({ price_ht: null, price_ttc: null });
  });
});

describe("parsing tableur", () => {
  const rows = [
    ["Code", "Libellé", "Modèle", "Énergie", "Prix TTC", "Temps"],
    ["RTPNE0", "Montage pneu SSPP", "Clio", "essence", "39,90", "0,4"],
    ["", "Ligne sans code", "", "", "10", ""],
    ["RTX999", "Ligne sans prix ni temps", "", "", "", ""],
  ];

  it("extrait les lignes exploitables et signale les autres", () => {
    const out = linesFromRows(rows, ctxPublic);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({
      operation_code: "RTPNE0",
      price_value: 39.9,
      price_basis: "ttc",
      hours: 0.4,
      brand: "Renault",
      energies: ["essence"],
    });
    expect(out.warnings).toHaveLength(2);
  });

  it("refuse un fichier sans en-têtes reconnus au lieu de deviner", () => {
    const out = linesFromRows([["a", "b"], ["1", "2"]], ctxPublic);
    expect(out.lines).toHaveLength(0);
    expect(out.warnings[0]).toContain("En-têtes non reconnus");
  });

  it("normalise les énergies", () => {
    expect(parseEnergies("Diesel / dCi")).toEqual(["diesel"]);
    expect(parseEnergies("inconnu")).toEqual([]);
  });
});

describe("parsing IA (PDF)", () => {
  it("écarte les lignes non fiables et remonte les avertissements", () => {
    const out = linesFromAi(
      {
        version: "02/2026",
        lines: [
          { operation_code: "rtpnf0", label: "Équilibrage", price: 25, page: 4 },
          { operation_code: "", label: "illisible", price: 12 },
          { operation_code: "RTX", label: "Sans prix" },
        ],
        warnings: ["page 7 : tableau non exploitable automatiquement"],
      },
      { ...ctxPublic, source_file_name: "memento.pdf", source_version: null },
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.operation_code).toBe("RTPNF0");
    expect(out.lines[0]?.source_version).toBe("02/2026");
    expect(out.lines[0]?.source_page).toBe(4);
    expect(out.warnings).toHaveLength(3);
  });
});

describe("idempotence de l'upsert", () => {
  const line: DetectedLine = {
    source_kind: "renault_public",
    source_file_name: "memento.pdf",
    source_version: "01/2026",
    source_page: 2,
    brand: "Renault",
    model: "Clio",
    segment: null,
    energies: ["essence"],
    operation_code: "RTPNE0",
    label: "Montage pneu",
    price_value: 39.9,
    price_basis: "ttc",
    hours: 0.4,
    parts_ht: null,
    year_from: null,
    year_to: null,
    notes: null,
  };

  it("même mémento réimporté = même clé de rapprochement", () => {
    expect(dedupeKey(line)).toBe(dedupeKey({ ...line, source_page: 9, source_file_name: "x" } as never));
    expect(dedupeKey(line)).toBe(dedupeKey({ ...line, operation_code: "rtpne0", brand: "RENAULT" }));
  });

  it("un contexte différent produit une clé différente", () => {
    expect(dedupeKey(line)).not.toBe(dedupeKey({ ...line, model: "Captur" }));
    expect(dedupeKey(line)).not.toBe(dedupeKey({ ...line, source_kind: "renault_pro_lld" }));
  });

  it("aucune modification détectée si prix, temps et période sont identiques", () => {
    const row = rowFromLine(line, null);
    expect(hasChanged(row as never, row)).toBe(false);
    expect(hasChanged(row as never, { ...row, price_ttc: 41 })).toBe(true);
  });

  it("la ligne prête à écrire reste compatible avec le moteur de chiffrage", () => {
    const row = rowFromLine(line, "u1");
    expect(row.price_ttc).toBe(39.9);
    expect(row.price_ht).toBe(33.25);
    expect(row.active).toBe(true);
    expect(row.operation_code).toBe("RTPNE0");
  });
});
