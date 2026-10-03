import { describe, expect, it, vi, beforeEach } from "vitest";
import { pendingReceptionOrders } from "@/lib/parts-site";

// Lignes réelles (base, 03/10/2026) : 1 commande active + 3 annulées, DISTRICASH 27173596, dossier 50971.
const SITE = "23f64579-eaa9-406d-aec7-d29731ba0020";
const SUP = "dc969574-78f5-452f-ad5e-ee9d8c6535d1";
const row = (id: string, status: string, created_at: string) => ({
  id, status, created_at, site_id: SITE, destination: "or", supplier_id: SUP, supplier_order_ref: "27173596",
  source_document_id: "e504e67e-611e-409d-b53e-351c2b294c06", repair_order_id: null, requested_or_number: "50971", plate: "EP-414-LW",
  suppliers: { name: "DISTRICASH" }, repair_orders: null,
  part_order_lines: [{ physical_reference: "16764", designation: "PN FIRE 165/70R14 XL 85T MULTISEAS-2", qty_ordered: 2, expected_unit_cost_ht: 52.16 }],
});
const DB = [
  row("183a5d0f-11c9-4a9e-bc37-cae4e8574c56", "cancelled", "2026-10-03T18:10:59Z"),
  row("afbcdde4-0b3f-4971-bcfa-603597374103", "cancelled", "2026-10-03T18:10:45Z"),
  row("0c82e7ea-b1e7-4097-a153-0876307044d1", "cancelled", "2026-10-03T18:00:24Z"),
  row("320e5eab-5d5d-49a4-ae5e-1a3eca96b88e", "ordered", "2026-10-03T18:00:13Z"),
];

let dbError: { message: string } | null = null;
const filters: [string, string, unknown][] = [];
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: chain,
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
    neq: (c: string, v: unknown) => (filters.push(["neq", c, v]), q),
    order: chain,
    limit: () => {
      const rows = DB.filter((r) => filters.every(([op, c, v]) => (op === "eq" ? (r as Record<string, unknown>)[c] === v : (r as Record<string, unknown>)[c] !== v)));
      return Promise.resolve(dbError ? { data: null, error: dbError } : { data: rows, error: null });
    },
  });
  return { supabase: { from: () => q } };
});

const { findSimilarOrder } = await import("@/lib/parts");

const candidate = (p: Partial<Parameters<typeof findSimilarOrder>[0]> = {}) => ({
  site_id: SITE, destination: "or", supplier_id: SUP, supplier_order_ref: "27173596", source_document_id: null,
  repair_order_id: null, requested_or_number: "50971", or_number: "50971", plate: "EP-414-LW",
  lines: [{ physical_reference: "16764", designation: "PN FIRE", qty_ordered: 2, expected_unit_cost_ht: 52.16 }], ...p,
});

beforeEach(() => { filters.length = 0; dbError = null; });

describe("commande similaire — cas réel 50971 / 16764 / 52,16", () => {
  it("détecte la commande active, ignore les 3 annulées", async () => {
    const hit = await findSimilarOrder(candidate());
    expect(hit?.order.id).toBe("320e5eab-5d5d-49a4-ae5e-1a3eca96b88e");
    expect(hit?.order.status).toBe("ordered");
    expect(hit?.sameSupplierRef).toBe(true);
  });
  it("quantité différente => alerte quand même", async () => {
    const hit = await findSimilarOrder(candidate({ lines: [{ physical_reference: "16 764", designation: "", qty_ordered: 1, expected_unit_cost_ht: 52.164 }] }));
    expect(hit?.order.id).toBe("320e5eab-5d5d-49a4-ae5e-1a3eca96b88e");
  });
  it("seulement la plaque connue côté formulaire => alerte", async () => {
    const hit = await findSimilarOrder(candidate({ requested_or_number: null, or_number: null, plate: "ep414lw" }));
    expect(hit?.order.id).toBe("320e5eab-5d5d-49a4-ae5e-1a3eca96b88e");
  });
  it("OR WinMotor rattaché côté formulaire (même n°) => alerte", async () => {
    const hit = await findSimilarOrder(candidate({ repair_order_id: "ro-1", requested_or_number: null, or_number: "50971" }));
    expect(hit?.order.id).toBe("320e5eab-5d5d-49a4-ae5e-1a3eca96b88e");
  });
  it("autre dossier, même plaque => pas d'alerte", async () => {
    expect(await findSimilarOrder(candidate({ requested_or_number: "50999", or_number: "50999" }))).toBeNull();
  });
  it("erreur de lecture => jamais un « aucun doublon » silencieux", async () => {
    dbError = { message: "boom" };
    await expect(findSimilarOrder(candidate())).rejects.toThrow(/Contrôle commande similaire impossible/);
  });
  it("commandes en attente de réception : les annulées n'apparaissent jamais", () => {
    expect(pendingReceptionOrders(DB).map((o) => o.id)).toEqual(["320e5eab-5d5d-49a4-ae5e-1a3eca96b88e"]);
  });
});
