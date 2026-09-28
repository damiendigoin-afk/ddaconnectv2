import { describe, expect, it } from "vitest";
import { allocationPlan, canAttachTo, orphanReceiptsForPlate } from "@/lib/receipt-attach";
import { formatPlate, normalizePlate, winmotorOrHistory } from "@/lib/plate";

const rec = (p: Record<string, unknown>) => ({ id: "r", site_id: "cas", plate: "HG-732-GH", repair_order_id: null, status: "validated", cancelled_at: null, ...p }) as never;
const line = (p: Record<string, unknown>) => ({ id: "l", article_id: "a", condition: "usable", qty_received: 2, qty_allocated: 0, repair_order_id: null, physical_reference: "7701", designation: "Filtre", ...p }) as never;

describe("rattachement ultérieur réception → OR", () => {
  it("normalisation espaces/casse/tirets", () => {
    for (const p of ["HG 732 GH", "hg732gh", "HG-732-GH", "Hg732gh"]) {
      expect(normalizePlate(p)).toBe("HG732GH");
      expect(formatPlate(p)).toBe("HG-732-GH");
    }
  });
  it("historique WinMotor = connaissance de plaque, jamais cible", () => {
    const h = winmotorOrHistory([{ or_number: "48751", invoice_date: "2026-04-30" }, { or_number: "46585", invoice_date: "2026-02-03" }]);
    expect(h[0]!.or_number).toBe("48751");
    expect(canAttachTo(null)).toBe(false);
    expect(canAttachTo({ id: "", or_number: "48751" })).toBe(false);
    expect(canAttachTo({ id: "or1", or_number: null })).toBe(false);
    expect(canAttachTo({ id: "or1", or_number: "51000" })).toBe(true);
  });
  it("détecte la réception orpheline par plaque normalisée, exclut annulées, rattachées, autre site", () => {
    const rows = [rec({ id: "a", plate: "hg 732 gh" }), rec({ id: "b", status: "cancelled" }), rec({ id: "c", cancelled_at: "x" }), rec({ id: "d", repair_order_id: "or0" }), rec({ id: "e", site_id: "lal" }), rec({ id: "f", plate: "AA-123-BB" })];
    expect(orphanReceiptsForPlate(rows, "HG732GH", "cas").map((r) => (r as { id: string }).id)).toEqual(["a"]);
    expect(orphanReceiptsForPlate(rows, "", "cas")).toEqual([]);
  });
  it("affectation seulement du reste utilisable, jamais réallouée ailleurs", () => {
    const plan = allocationPlan([line({ id: "1" }), line({ id: "2", qty_allocated: 2 }), line({ id: "3", condition: "damaged_return" }), line({ id: "4", repair_order_id: "autre" }), line({ id: "5", article_id: null }), line({ id: "6", qty_received: 3, qty_allocated: 1 })], "or1");
    expect(plan.map((p) => [p.line.id, p.qty])).toEqual([["1", 2], ["6", 2]]);
  });
});
