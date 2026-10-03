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
      <option value="bergerac">RENAULT BERGERAC - GROUPE FAURIE</option>
    </select>
  ),
  PriceInput: ({ value, ...props }: { value?: number | null; [key: string]: unknown }) => <input {...props} value={value ?? ""} readOnly />,
  OrLink: () => null,
  LogisticsBadge: () => null,
  usePartsCtx: () => ({ actor: { userId: "user", name: "Test" }, writeSite: "site", siteName: () => "DDA", sites: [] }),
  useSuppliers: () => ({ data: [{ id: "client", name: "SAS CASTILLON VEYSSIERE", active: true }, { id: "sarlat", name: "FAURIE AUTO SARLAT", active: true }, { id: "bergerac", name: "RENAULT BERGERAC - GROUPE FAURIE", active: true }] }),
  btnGhost: "",
  btnPrimary: "",
  inputCls: "",
  numOrNull: (value: string) => Number(value),
}));

vi.mock("@/lib/parts", () => ({
  allocateToOr: vi.fn(), createOrder: vi.fn(), findDuplicateOrder: vi.fn().mockResolvedValue(null), findOrByNumber: vi.fn().mockResolvedValue(null),
  findStockByRef: vi.fn().mockResolvedValue([]), listOrders: vi.fn().mockResolvedValue([]), openRegularization: vi.fn(),
}));
vi.mock("@/lib/refbase", () => ({ findRefVehicleByPlate: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supplier-docs", () => ({ ORDER_DOC_TYPE: "supplier_order", uploadSupplierDoc: vi.fn(), findExistingSupplierDocId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-docs", () => ({ linkDocToOrder: vi.fn() }));

import { OrderForm } from "@/routes/pieces-achats.commandes";
import { purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { initialOrderSupplier } from "@/lib/order-supplier";
import { RENAULT_46104548_REAL } from "./fixtures/renault-46104548-real";

afterEach(cleanup);

const SUPS = [{ id: "client", name: "SAS CASTILLON VEYSSIERE", active: true }, { id: "sarlat", name: "FAURIE AUTO SARLAT", active: true }, { id: "bergerac", name: "RENAULT BERGERAC - GROUPE FAURIE", active: true }];

function expectLines() {
  expect(screen.getAllByLabelText("Référence").map((n) => (n as HTMLInputElement).value)).toEqual(["8660004937", "8660003779"]);
  expect(screen.getAllByLabelText("Désignation").map((n) => (n as HTMLInputElement).value)).toEqual(["MOTRIO Filtre d'habitacle -Pol", "MOTRIO Filtre à huile"]);
  expect(screen.getAllByLabelText("Quantité").map((n) => (n as HTMLInputElement).value)).toEqual(["1", "1"]);
  expect(screen.getAllByLabelText("PA HT").map((n) => (n as HTMLInputElement).value)).toEqual(["11.64", "6.77"]);
}

describe("Commander des pièces — Renault 46104548 réel, lignes dans l'écran", () => {
  it("texte réel -> formulaire : 2 lignes exactes, fournisseur FAURIE AUTO SARLAT", async () => {
    const extracted = normalizePurchaseExtract(purchaseRules(RENAULT_46104548_REAL));
    const doc = { file: new File(["x"], "52a95b53.pdf", { type: "application/pdf" }), warning: null, extracted };
    render(<OrderForm doc={doc as never} docSite={null} initialSupplier={initialOrderSupplier(extracted, SUPS)} onDone={vi.fn()} />);
    expectLines();
    await waitFor(() => expect(screen.getByLabelText("Fournisseur")).toHaveProperty("value", "sarlat"));
    expectLines();
    expect(screen.getByPlaceholderText("N° commande fournisseur")).toHaveProperty("value", "46104548");
    expect(screen.getByLabelText("OR")).toHaveProperty("value", "50969");
  });
  it("alias résolu après coup (supplier_id auto erroné) : la sélection fournisseur n'efface pas les lignes", async () => {
    const extracted = { ...normalizePurchaseExtract(purchaseRules(RENAULT_46104548_REAL)), supplier_id: "client" };
    const doc = { file: new File(["x"], "52a95b53.pdf", { type: "application/pdf" }), warning: null, extracted };
    render(<OrderForm doc={doc as never} docSite={null} initialSupplier="" onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Fournisseur")).toHaveProperty("value", "sarlat"));
    expect(screen.getByLabelText("Fournisseur")).not.toHaveProperty("value", "bergerac");
    expectLines();
  });
});
