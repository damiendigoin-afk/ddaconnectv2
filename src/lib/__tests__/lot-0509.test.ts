import { describe, expect, it } from "vitest";

import { emptyContext, parseDocument, parseRow, type PageText } from "../packages-parse";
import { dedupeKey } from "../packages-import";
import { computeStatus, statusText } from "../integration-status";
import { currentRotation, rotationQueue, ROTATION_DAYS, DAY_MS, type SiteAdAsset } from "../communication-site";
import { equivalentsFor, searchEquivalences, type VehicleEquivalence } from "../vehicle-equivalences";

/* ------------------------------ Import forfaits --------------------------- */

const frag = (rows: string[], page: number): PageText => ({
  page,
  fragments: rows.map((str, i) => ({ str, x: 0, y: 1000 - i * 12 })),
});

describe("parseur mémento : champs séparés", () => {
  it("sépare modèle, motorisation, code et prix sans les concaténer", () => {
    const r = parseRow("CAPTUR II EUROPE / SYMBIOZ 1.3 16V RXMNAK 1739");
    expect(r).not.toBeNull();
    expect(r!.code).toBe("RXMNAK");
    expect(r!.engine).toBe("1.3 16V");
    expect(r!.model).toBe("CAPTUR II EUROPE / SYMBIOZ");
    expect(r!.generation).toBe("II");
    expect(r!.price).toBe(1739);
  });

  it("ne confond pas un mot du modèle avec un code forfait", () => {
    expect(parseRow("CAPTUR II EUROPE 1.3 16V 1739")?.code).not.toBe("EUROPE");
  });

  it("refuse une ligne sans prix", () => {
    expect(parseRow("CLIO V 1.0 TCe RSPNCC")).toBeNull();
  });
});

describe("contexte multi-pages", () => {
  const pages = [
    frag(["ÉCHAPPEMENT", "Remplacement du silencieux", "CAPTUR II 1.3 16V RXMNAK 1739"], 1),
    frag(["CLIO V 1.0 TCe RXMNAL 1450"], 2),
    frag(["Remplacement du catalyseur", "CLIO V 1.5 dCi RXMNAM 1980"], 3),
  ];

  const out = parseDocument(pages, {
    kind: "renault_public",
    fileName: "memento.pdf",
    version: "01/2026",
    context: emptyContext("01/2026"),
  });

  it("garde le titre d'opération sur la page suivante jusqu'au titre suivant", () => {
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]!.label).toBe("Remplacement du silencieux");
    expect(out.lines[1]!.label).toBe("Remplacement du silencieux");
    expect(out.lines[2]!.label).toBe("Remplacement du catalyseur");
  });

  it("garde la famille et la page source", () => {
    expect(out.lines.every((l) => l.family === "ÉCHAPPEMENT")).toBe(true);
    expect(out.lines.map((l) => l.source_page)).toEqual([1, 2, 3]);
  });

  it("conserve zone, périmètre et version du mémento", () => {
    expect(out.lines[0]!.zone).toBe("C");
    expect(out.lines[0]!.tier).toBe("public");
    expect(out.lines[0]!.source_version).toBe("01/2026");
  });

  it("le contexte survit à un traitement par lots successifs", () => {
    const first = parseDocument([pages[0]!], {
      kind: "renault_public",
      fileName: "memento.pdf",
      version: "01/2026",
    });
    const second = parseDocument([pages[1]!], {
      kind: "renault_public",
      fileName: "memento.pdf",
      version: "01/2026",
      context: first.context,
    });
    expect(second.lines[0]!.label).toBe("Remplacement du silencieux");
  });
});

describe("idempotence du réimport", () => {
  it("le même mémento réimporté produit la même clé", () => {
    const a = { brand: "Renault", operation_code: "RXMNAK", model: "CAPTUR II", engine: "1.3 16V", source_kind: "renault_public" as const, label: "x" };
    expect(dedupeKey(a)).toBe(dedupeKey({ ...a, model: "captur ii" }));
  });
  it("une motorisation différente reste un forfait distinct", () => {
    const a = { brand: "Renault", operation_code: "RXMNAK", model: "CLIO V", engine: "1.0 TCe", source_kind: "renault_public" as const, label: "x" };
    expect(dedupeKey(a)).not.toBe(dedupeKey({ ...a, engine: "1.5 dCi" }));
  });
});

/* --------------------------- Rotation Communication ------------------------ */

const asset = (o: Partial<SiteAdAsset> & { id: string }): SiteAdAsset => ({
  site_id: "s1",
  title: o.id,
  storage_path: `p/${o.id}`,
  file_name: null,
  mime_type: "image/jpeg",
  active: true,
  archived: false,
  shown_count: 0,
  last_shown_at: null,
  started_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...o,
});

describe("rotation 7 jours par site", () => {
  const now = new Date("2026-09-10T10:00:00Z");
  const running = asset({
    id: "a",
    started_at: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
    created_at: "2026-01-01T00:00:00Z",
  });
  const waiting = asset({ id: "b", created_at: "2026-02-01T00:00:00Z" });

  it("la campagne en cours n'est pas interrompue par la préparation de la suivante", () => {
    const r = currentRotation([running, waiting], now);
    expect(r.current?.id).toBe("a");
    expect(r.next.map((a) => a.id)).toEqual(["b"]);
  });

  it("au bout de 7 jours la file avance", () => {
    const finished = { ...running, started_at: new Date(now.getTime() - (ROTATION_DAYS + 1) * DAY_MS).toISOString() };
    expect(currentRotation([finished, waiting], now).current?.id).toBe("b");
  });

  it("un visuel désactivé sort de la rotation et y revient une fois réactivé", () => {
    const off = { ...waiting, active: false };
    expect(rotationQueue([off]).length).toBe(0);
    expect(rotationQueue([{ ...off, active: true }]).length).toBe(1);
  });

  it("sans visuel actif, aucune diffusion n'est inventée", () => {
    expect(currentRotation([], now).current).toBeNull();
  });
});

/* ------------------------------ Statuts API -------------------------------- */

describe("statuts des connexions externes", () => {
  it("sans clé ni compte : non configuré", () => {
    expect(computeStatus({ configured: false })).toBe("non_configure");
  });
  it("clé présente jamais testée : configuré, pas « inactif »", () => {
    expect(statusText({ configured: true, active: false })).toBe("Configuré — jamais testé");
  });
  it("dernier test en échec : erreur avec message", () => {
    expect(statusText({ configured: true, lastCheckOk: false, lastCheckMessage: "clé refusée" })).toBe(
      "Erreur — clé refusée",
    );
  });
  it("testé puis activé : actif", () => {
    expect(computeStatus({ configured: true, active: true, lastCheckOk: true })).toBe("actif");
    expect(computeStatus({ configured: true, active: false, lastCheckOk: true })).toBe("teste");
  });
});

/* ---------------------------- Équivalences véhicules ----------------------- */

const eq = (o: Partial<VehicleEquivalence>): VehicleEquivalence => ({
  id: o.id ?? "e1",
  brand_a: "Peugeot",
  model_a: "2008",
  brand_b: "Renault",
  model_b: "Captur",
  segment: "B SUV",
  body_type: "SUV urbain",
  generation: null,
  year_from: null,
  year_to: null,
  engine: null,
  confidence: "fort",
  reason: "même segment et gabarit",
  scope: "generaliste",
  active: true,
  created_at: "",
  updated_at: "",
  ...o,
});

describe("équivalences véhicules", () => {
  it("propose l'équivalent dans les deux sens", () => {
    expect(equivalentsFor([eq({})], "Captur")[0]?.model).toBe("2008");
    expect(equivalentsFor([eq({})], "2008")[0]?.model).toBe("Captur");
  });
  it("ne propose rien hors période de validité", () => {
    const rows = [eq({ year_from: 2020, year_to: 2024 })];
    expect(equivalentsFor(rows, "Captur", { year: 2015 })).toHaveLength(0);
  });
  it("une équivalence désactivée n'est jamais appliquée", () => {
    expect(equivalentsFor([eq({ active: false })], "Captur")).toHaveLength(0);
  });
  it("classe le rapprochement fiable avant le douteux", () => {
    const rows = [eq({ id: "1", confidence: "faible", model_a: "C3" }), eq({ id: "2", confidence: "fort", model_a: "208" })];
    expect(equivalentsFor(rows, "Captur")[0]?.model).toBe("208");
  });
  it("recherche par segment ou carrosserie", () => {
    expect(searchEquivalences([eq({})], "suv")).toHaveLength(1);
    expect(searchEquivalences([eq({})], "berline")).toHaveLength(0);
  });
});
