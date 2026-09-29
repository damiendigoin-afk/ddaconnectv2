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
      <option value="supplier-pad">OSKARBI AUTO SL</option>
    </select>
  ),
  PriceInput: ({ value, ...props }: { value?: number | null; [key: string]: unknown }) => <input {...props} value={value ?? ""} readOnly />,
  OrLink: () => null,
  usePartsCtx: () => ({ actor: { userId: "user", name: "Test" }, writeSite: "site", siteName: () => "DDA", sites: [] }),
  useSuppliers: () => ({ data: [{ id: "supplier-pad", name: "OSKARBI AUTO SL" }] }),
  btnGhost: "",
  btnPrimary: "",
  inputCls: "",
  numOrNull: (value: string) => Number(value),
}));

vi.mock("@/lib/parts", () => ({
  allocateToOr: vi.fn(), createOrder: vi.fn(), findOrByNumber: vi.fn().mockResolvedValue(null),
  findStockByRef: vi.fn().mockResolvedValue([]), listOrders: vi.fn().mockResolvedValue([]), openRegularization: vi.fn(),
}));
vi.mock("@/lib/refbase", () => ({ findRefVehicleByPlate: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supplier-docs", () => ({ ORDER_DOC_TYPE: "supplier_order", uploadSupplierDoc: vi.fn() }));
vi.mock("@/lib/order-docs", () => ({ linkDocToOrder: vi.fn() }));

import { OrderForm } from "@/routes/pieces-achats.commandes";

afterEach(cleanup);

describe("Commander des pièces — contrat DOM réel", () => {
  it("affiche les valeurs PAD 2887178 dans les inputs réellement rendus", async () => {
    const file = new File(["PAD"], "pad meg3 COMMANDE 2887178.pdf", { type: "application/pdf" });
    const doc = {
      file,
      warning: null,
      extracted: {
        supplier: "OSKARBI AUTO SL",
        supplier_id: "supplier-pad",
        order_reference: "2887178",
        order_date: "2026-09-29",
        or_number: "16533",
        plate: "DC-354-ZH",
        shipping_ht: 25,
        shipping_label: "Frais de port et de emballage",
        lines: [
          { reference: "", label: "", quantity: null, unit_price: null, physical_reference: "557119W", designation: "Support pare-chocs avant droit", qty_ordered: 1, expected_unit_cost_ht: 24.51 },
          { reference: null, label: null, quantity: null, unit_price: null, physical_reference: "5571208", designation: "Amortisseur de pare-chocs avant", qty_ordered: 1, expected_unit_cost_ht: 19.7 },
          { reference: "", label: "", quantity: null, unit_price: null, physical_reference: "5571209", designation: "Support de grille", qty_ordered: 1, expected_unit_cost_ht: 50.01 },
        ],
      },
    };

    render(<OrderForm doc={doc as never} docSite={null} initialSupplier="supplier-pad" onDone={vi.fn()} />);

    expect(screen.getByLabelText("Fournisseur")).toHaveProperty("value", "supplier-pad");
    expect(screen.getByPlaceholderText("N° commande fournisseur")).toHaveProperty("value", "2887178");
    expect(screen.getByLabelText("Date de commande")).toHaveProperty("value", "2026-09-29");
    expect(screen.getByLabelText("OR")).toHaveProperty("value", "16533");
    expect(screen.getAllByLabelText("Référence").map((node) => (node as HTMLInputElement).value)).toEqual(["557119W", "5571208", "5571209", ""]);
    expect(screen.getAllByLabelText("Désignation").map((node) => (node as HTMLInputElement).value)).toEqual(["Support pare-chocs avant droit", "Amortisseur de pare-chocs avant", "Support de grille", "Frais de port et de emballage"]);
    expect(screen.getAllByLabelText("Quantité").map((node) => (node as HTMLInputElement).value)).toEqual(["1", "1", "1", "1"]);
    expect(screen.getAllByLabelText("PA HT").map((node) => (node as HTMLInputElement).value)).toEqual(["24.51", "19.7", "50.01", "25"]);
    expect(screen.getAllByLabelText("Type de ligne").map((node) => (node as HTMLSelectElement).value)).toEqual(["part", "part", "part", "fee"]);
    await waitFor(() => expect(screen.getByLabelText("Immatriculation")).toHaveProperty("value", "DC-354-ZH"));
  });
});