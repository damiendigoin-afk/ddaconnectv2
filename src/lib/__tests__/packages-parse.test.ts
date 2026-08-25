import { describe, expect, it } from "vitest";

import { detectVersion, groupLines, parseDocument, parsePage, toNum } from "../packages-parse";
import type { PageText } from "../packages-parse";

const frag = (str: string, x: number, y: number) => ({ str, x, y });

function page(n: number, rows: string[][]): PageText {
  const fragments = rows.flatMap((cells, r) =>
    cells.map((c, i) => frag(c, i * 100, 800 - r * 20)),
  );
  return { page: n, fragments };
}

describe("groupLines", () => {
  it("regroupe les fragments par ligne et les ordonne en X", () => {
    const rows = groupLines([frag("PRIX", 300, 700), frag("RTPNE0", 10, 700), frag("Autre", 10, 660)]);
    expect(rows[0]).toBe("RTPNE0 PRIX");
    expect(rows[1]).toBe("Autre");
  });
});

describe("toNum / detectVersion", () => {
  it("lit les nombres à la française", () => {
    expect(toNum("1 234,50")).toBe(1234.5);
    expect(toNum("89,90")).toBe(89.9);
  });
  it("détecte la version imprimée", () => {
    expect(detectVersion(["Mémento tarifs 01/2026"])).toBe("01/2026");
    expect(detectVersion(["sans version"])).toBeNull();
  });
});

describe("parsePage", () => {
  const opts = { kind: "renault_public" as const, fileName: "memento.pdf", version: "01/2026" };

  it("extrait code, libellé, temps et prix sans IA", () => {
    const out = parsePage(page(7, [["RTPNE0", "Montage pneumatique", "0,30", "24,90"]]), opts);
    expect(out.lines).toHaveLength(1);
    const l = out.lines[0]!;
    expect(l.operation_code).toBe("RTPNE0");
    expect(l.label).toContain("Montage");
    expect(l.hours).toBe(0.3);
    expect(l.price_value).toBe(24.9);
    expect(l.price_basis).toBe("ttc");
    expect(l.source_page).toBe(7);
    expect(l.source_version).toBe("01/2026");
  });

  it("applique la base HT pour le mémento Pro / LLD", () => {
    const out = parsePage(page(3, [["FVIDA1", "Vidange", "0,50", "72,00"]]), {
      ...opts,
      kind: "renault_pro_lld",
    });
    expect(out.lines[0]!.price_basis).toBe("ht");
    expect(out.lines[0]!.brand).toBe("Renault");
  });

  it("signale une ligne sans prix au lieu de l'importer", () => {
    const out = parsePage(page(4, [["RTPNE0", "Montage pneumatique"]]), opts);
    expect(out.lines).toHaveLength(0);
    expect(out.uncertain[0]).toContain("page 4");
  });

  it("signale une page scannée sans jamais appeler l'IA", () => {
    const out = parsePage({ page: 12, fragments: [] }, opts);
    expect(out.scanned).toBe(true);
    expect(out.lines).toHaveLength(0);
    expect(out.uncertain[0]).toContain("scannée");
  });
});

describe("parseDocument", () => {
  it("agrège les pages et liste les pages scannées", () => {
    const doc = parseDocument(
      [
        page(1, [["RTPNE0", "Montage", "0,30", "24,90"]]),
        { page: 2, fragments: [] },
        page(3, [["FDISQ2", "Disques avant", "1,20", "289,00"]]),
      ],
      { kind: "dacia_public", fileName: "dacia.pdf", version: null },
    );
    expect(doc.lines.map((l) => l.operation_code)).toEqual(["RTPNE0", "FDISQ2"]);
    expect(doc.scannedPages).toEqual([2]);
    expect(doc.lines[1]!.source_page).toBe(3);
    expect(doc.lines[0]!.brand).toBe("Dacia");
  });
});
