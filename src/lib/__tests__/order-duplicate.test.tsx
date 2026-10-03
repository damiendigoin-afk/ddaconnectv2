// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { duplicateIdFromDbError, isDuplicateOrder, type ExistingOrder, type OrderKey } from "@/lib/order-duplicate";

const base: OrderKey = {
  site_id: "castillon", destination: "or", supplier_id: "districash", supplier_order_ref: "27173596",
  source_document_id: "e504e67e-611e-409d-b53e-351c2b294c06", repair_order_id: null, requested_or_number: "50971", plate: "EP-414-LW",
};
const existing: ExistingOrder = { ...base, id: "320e5eab-5d5d-49a4-ae5e-1a3eca96b88e", status: "ordered" };

describe("Règles anti-doublon commandes fournisseur", () => {
  it("même document + même cible => doublon", () => {
    expect(isDuplicateOrder({ ...base, supplier_order_ref: null }, existing)).toBe(true);
  });
  it("même fournisseur/ref + même cible, autre document => doublon", () => {
    expect(isDuplicateOrder({ ...base, source_document_id: "autre" }, existing)).toBe(true);
  });
  it("même fournisseur/ref + autre OR => autorisé (multi-OR)", () => {
    expect(isDuplicateOrder({ ...base, requested_or_number: "50972" }, existing)).toBe(false);
    expect(isDuplicateOrder({ ...base, source_document_id: "autre", requested_or_number: "50972" }, existing)).toBe(false);
  });
  it("commande existante annulée => autorisé", () => {
    expect(isDuplicateOrder(base, { ...existing, status: "cancelled" })).toBe(false);
  });
  it("plaque normalisée comme cible quand aucun dossier", () => {
    const k = { ...base, requested_or_number: null, plate: "ep414lw" };
    expect(isDuplicateOrder(k, { ...existing, requested_or_number: null })).toBe(true);
  });
  it("erreur base reconnue avec l'ID existant", () => {
    expect(duplicateIdFromDbError(`DUPLICATE_PART_ORDER:${existing.id}`)).toBe(existing.id);
    expect(duplicateIdFromDbError("autre erreur")).toBeUndefined();
  });
});

/* ------------------------------- Formulaire ------------------------------- */

const createOrder = vi.fn();
const findDuplicateOrder = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (o: unknown) => o,
  lazyRouteComponent: () => () => null,
  Link: ({ children, params }: { children: React.ReactNode; params?: { orderId?: string } }) => <a href={`/pieces-achats/commande/${params?.orderId}`}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/parts/OrderRow", () => ({ OrderRow: () => null }));
vi.mock("@/components/parts/DocDropZone", () => ({ DocDropZone: () => null }));
vi.mock("@/components/parts/DocSupplierLink", () => ({ DocSupplierLink: () => null }));
vi.mock("@/components/parts/PartsUi", () => ({
  ActiveSiteNote: () => null, SiteMismatchAlert: () => null,
  OrPicker: () => null,
  SupplierSelect: ({ value }: { value: string }) => <input aria-label="Fournisseur" value={value} readOnly />,
  PriceInput: () => null, OrLink: () => null, LogisticsBadge: () => null,
  usePartsCtx: () => ({ actor: { userId: "u", name: "T" }, writeSite: "castillon", siteName: () => "Castillon", sites: [] }),
  useSuppliers: () => ({ data: [{ id: "districash", name: "DISTRICASH" }] }),
  btnGhost: "", btnPrimary: "", inputCls: "", numOrNull: Number,
}));
vi.mock("@/lib/parts", () => ({
  allocateToOr: vi.fn(), createOrder: (...a: unknown[]) => createOrder(...a), findDuplicateOrder: (...a: unknown[]) => findDuplicateOrder(...a),
  findOrByNumber: vi.fn().mockResolvedValue(null), findStockByRef: vi.fn().mockResolvedValue([]),
  listOrders: vi.fn().mockResolvedValue([]), openRegularization: vi.fn(),
}));
vi.mock("@/lib/refbase", () => ({ findRefVehicleByPlate: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supplier-docs", () => ({ ORDER_DOC_TYPE: "supplier_order", uploadSupplierDoc: vi.fn(), findExistingSupplierDocId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-docs", () => ({ linkDocToOrder: vi.fn() }));

import { OrderForm } from "@/routes/pieces-achats.commandes";

afterEach(() => { cleanup(); createOrder.mockReset(); findDuplicateOrder.mockReset(); });

function renderForm() {
  return render(<OrderForm doc={null} initialSupplier="districash" onDone={() => undefined} />);
}

describe("Commander des pièces — anti-doublon", () => {
  it("doublon : bloc rouge avec lien vers l'existant, bouton désactivé", async () => {
    findDuplicateOrder.mockResolvedValue({ ...existing, suppliers: { name: "DISTRICASH" }, repair_orders: null, created_at: "2026-10-03T10:00:00Z" });
    renderForm();
    fireEvent.change(screen.getByPlaceholderText("N° commande fournisseur"), { target: { value: "27173596" } });
    const block = await screen.findByTestId("order-duplicate", {}, { timeout: 2000 });
    expect(block.textContent).toContain("Commande déjà enregistrée");
    expect(block.textContent).toContain("27173596");
    expect(block.querySelector("a")!.getAttribute("href")).toBe(`/pieces-achats/commande/${existing.id}`);
    expect((screen.getByText("Valider la commande") as HTMLButtonElement).disabled).toBe(true);
  });

  it("double clic rapide => un seul createOrder", async () => {
    findDuplicateOrder.mockResolvedValue(null);
    createOrder.mockImplementation(() => new Promise((r) => setTimeout(() => r("new-id"), 50)));
    renderForm();
    const btn = screen.getByText("Valider la commande");
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("doublon détecté au moment de valider => rien n'est créé", async () => {
    findDuplicateOrder.mockResolvedValueOnce(null).mockResolvedValue({ ...existing, suppliers: null, repair_orders: null });
    renderForm();
    fireEvent.click(screen.getByText("Valider la commande"));
    await waitFor(() => expect(findDuplicateOrder).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(createOrder).not.toHaveBeenCalled();
  });
});
