// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  lazyRouteComponent: () => () => null,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/parts/OrderRow", () => ({ OrderRow: () => null }));
vi.mock("@/components/parts/DocDropZone", () => ({ DocDropZone: () => null }));
vi.mock("@/components/parts/DocSupplierLink", () => ({ DocSupplierLink: () => null }));
vi.mock("@/components/parts/PartsUi", () => ({
  ActiveSiteNote: () => null,
  SiteMismatchAlert: () => null,
  OrPicker: ({ initialNumber, value }: { initialNumber?: string | null; value?: { plate?: string } }) => <><input aria-label="OR" value={initialNumber ?? ""} readOnly /><input aria-label="Immatriculation" value={value?.plate ?? ""} readOnly /></>,
  SupplierSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="Fournisseur" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">— Fournisseur —</option>
      <option value="sarlat">FAURIE AUTO SARLAT</option>
      <option value="dc">DISTRICASH</option>
      <option value="bergerac">RENAULT BERGERAC - GROUPE FAURIE</option>
    </select>
  ),
  PriceInput: ({ value, ...props }: { value?: number | null; [key: string]: unknown }) => <input {...props} value={value ?? ""} readOnly />,
  OrLink: () => null,
  LogisticsBadge: () => null,
  usePartsCtx: () => ({ actor: { userId: "user", name: "Test" }, writeSite: "site", siteName: () => "DDA", sites: [] }),
  useSuppliers: () => ({ data: SUPS }),
  btnGhost: "", btnPrimary: "", inputCls: "",
  numOrNull: (value: string) => Number(value),
}));
vi.mock("@/lib/parts", () => ({
  allocateToOr: vi.fn(), createOrder: vi.fn(), findSimilarOrder: vi.fn().mockResolvedValue(null), findOrByNumber: vi.fn().mockResolvedValue(null),
  findStockByRef: vi.fn().mockResolvedValue([]), listOrders: vi.fn().mockResolvedValue([]), openRegularization: vi.fn(),
}));
vi.mock("@/lib/refbase", () => ({ findRefVehicleByPlate: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supplier-docs", () => ({ ORDER_DOC_TYPE: "supplier_order", uploadSupplierDoc: vi.fn(), findExistingSupplierDocId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-docs", () => ({ linkDocToOrder: vi.fn() }));

import fs from "node:fs";
import path from "node:path";
import { OrderForm } from "@/routes/pieces-achats.commandes";
import { purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { initialOrderSupplier } from "@/lib/order-supplier";
import { canonicalSupplierName, supplierMenu } from "@/lib/supplier-aliases";

var SUPS = [
  { id: "client", name: "SAS CASTILLON VEYSSIERE", active: true },
  { id: "sarlat", name: "FAURIE AUTO SARLAT", active: true },
  { id: "dc", name: "DISTRICASH", active: true },
  { id: "bergerac", name: "RENAULT BERGERAC - GROUPE FAURIE", active: true },
];

/** Texte du VRAI PDF, regroupé par ligne exactement comme doc-text.browser.ts (y arrondi à 3, tri x). */
async function realText(): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures/commande-27173596.pdf")));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]! / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4]!, s: it.str }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(" "));
  }
  return out.join("\n");
}

afterEach(cleanup);

describe("Commande DISTRI CASH 27173596 — vrai PDF", () => {
  it("lecture : fournisseur, repérage, ligne unique au PA net, totaux", async () => {
    const f = purchaseRules(await realText()) as any;
    expect(f.template).toBe("logiweb_commande");
    expect(f.doc_kind).toBe("commande");
    expect(canonicalSupplierName(f.supplier)).toBe("DISTRICASH");
    expect(f.supplier_client_number).toBe("19025");
    expect(f.order_reference).toBe("27173596");
    expect(f.document_date).toBe("2026-10-02");
    expect(f.document_reference).toBe("50971");
    expect(f.plate).toMatch(/EP-?414-?LW/);
    expect(f.order_origin).toBe("LOGIWEB");
    expect(f.lines).toEqual([{ reference: "16764", label: "PN FIRE 165/70R14 XL 85T MULTISEAS-2", quantity: 2, unit_price: 52.16, amount: 104.32 }]);
    expect([f.total_ht, f.vat_amount, f.total_ttc]).toEqual([104.32, 20.86, 125.18]);
    expect(f.control_alerts).toEqual([]);
  });
  it("alias : variations DISTRI CASH -> DISTRICASH", () => {
    for (const n of ["DISTRI CASH BRIVE", "distri  cash", "Districash Brive"]) expect(canonicalSupplierName(n)).toBe("DISTRICASH");
    expect(canonicalSupplierName("AUTO DISTRIBUTION / AD")).toBeNull();
  });
  it("formulaire ouvert déjà rempli : DISTRICASH, EP414LW, repère 50971, 16764 x2 à 52,16", async () => {
    const extracted = normalizePurchaseExtract(purchaseRules(await realText()));
    const doc = { file: new File(["x"], "commande-27173596.pdf", { type: "application/pdf" }), warning: null, extracted };
    render(<OrderForm doc={doc as never} docSite={null} initialSupplier={initialOrderSupplier(extracted, SUPS)} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Fournisseur")).toHaveProperty("value", "dc"));
    expect(screen.getAllByLabelText("Référence").map((n) => (n as HTMLInputElement).value)).toEqual(["16764"]);
    expect(screen.getAllByLabelText("Désignation").map((n) => (n as HTMLInputElement).value)).toEqual(["PN FIRE 165/70R14 XL 85T MULTISEAS-2"]);
    expect(screen.getAllByLabelText("Quantité").map((n) => (n as HTMLInputElement).value)).toEqual(["2"]);
    expect(screen.getAllByLabelText("PA HT").map((n) => (n as HTMLInputElement).value)).toEqual(["52.16"]);
    expect(screen.getByPlaceholderText("N° commande fournisseur")).toHaveProperty("value", "27173596");
    expect(screen.getByLabelText("OR")).toHaveProperty("value", "50971");
    expect((screen.getByLabelText("Immatriculation") as HTMLInputElement).value.replace(/-/g, "")).toBe("EP414LW");
  });
  it("menu fournisseur : aucun doublon entre « plus utilisés » et la liste générale", () => {
    const sups = [...SUPS, { id: "dc2", name: "Districash", active: true }, { id: "ad", name: "AUTO DISTRIBUTION / AD", active: true }];
    const m = supplierMenu(sups, ["dc", "sarlat", "dc"], "", "");
    const ids = [...m.top, ...m.rest].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.top.map((s) => s.id)).toEqual(["dc", "sarlat"]);
    expect(ids).not.toContain("dc2");
  });
});
