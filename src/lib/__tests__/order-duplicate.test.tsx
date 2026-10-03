// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findSimilarIn, similarConfirmText, type OrderKey, type PastOrder } from "@/lib/order-duplicate";

const key: OrderKey = {
  site_id: "castillon", destination: "or", supplier_id: "districash", supplier_order_ref: null,
  source_document_id: null, repair_order_id: null, requested_or_number: "50971", plate: "EP-414-LW",
};
const pneu = { physical_reference: "16764", designation: "PN FIRE 165/70R14", expected_unit_cost_ht: 52.16 };
const past: PastOrder = {
  ...key, id: "320e5eab-5d5d-49a4-ae5e-1a3eca96b88e", status: "ordered", created_at: "2026-10-03T18:00:00Z",
  supplier_order_ref: "27173596", source_document_id: "doc-1", part_order_lines: [{ ...pneu, qty_ordered: 1 }],
};
const cand = (o: Partial<OrderKey> = {}, l = [{ ...pneu, qty_ordered: 1 }]) => ({ ...key, ...o, lines: l });

describe("Commande similaire — avertissement", () => {
  it("même fournisseur + même OR + même réf + même PA => alerte", () => {
    expect(findSimilarIn(cand(), [past])?.order.id).toBe(past.id);
  });
  it("quantité différente => alerte quand même", () => {
    expect(findSimilarIn(cand({}, [{ ...pneu, qty_ordered: 2 }]), [past])).not.toBeNull();
  });
  it("autre OR => pas d'alerte", () => {
    expect(findSimilarIn(cand({ requested_or_number: "50972" }), [past])).toBeNull();
  });
  it("autre référence => pas d'alerte", () => {
    expect(findSimilarIn(cand({}, [{ ...pneu, physical_reference: "16765", qty_ordered: 1 }]), [past])).toBeNull();
  });
  it("même référence, autre PA => pas d'alerte ; écart < centime => alerte", () => {
    expect(findSimilarIn(cand({}, [{ ...pneu, expected_unit_cost_ht: 52.2, qty_ordered: 1 }]), [past])).toBeNull();
    expect(findSimilarIn(cand({}, [{ ...pneu, expected_unit_cost_ht: 52.161, qty_ordered: 1 }]), [past])).not.toBeNull();
  });
  it("référence normalisée (espaces/casse)", () => {
    expect(findSimilarIn(cand({}, [{ ...pneu, physical_reference: " 16-764 ", qty_ordered: 1 }]), [past])).not.toBeNull();
  });
  it("commande annulée => pas d'alerte", () => {
    expect(findSimilarIn(cand(), [{ ...past, status: "cancelled" }])).toBeNull();
  });
  it("destination différente => pas d'alerte", () => {
    expect(findSimilarIn(cand({ destination: "stock" }), [past])).toBeNull();
  });
  it("même document ou même n° fournisseur => texte renforcé", () => {
    const s1 = findSimilarIn(cand({ source_document_id: "doc-1" }), [past])!;
    expect(s1.sameDocument).toBe(true);
    expect(similarConfirmText(s1)).toMatch(/^Même bon de commande déjà importé, passée le \d\d\/\d\d\/\d{4} à \d\d:\d\d/);
    const s2 = findSimilarIn(cand({ supplier_order_ref: "27173596" }), [past])!;
    expect(s2.sameSupplierRef).toBe(true);
    expect(similarConfirmText(findSimilarIn(cand(), [past])!)).toMatch(/^Une commande similaire existe déjà, passée le .* Voulez-vous vraiment créer une nouvelle commande \?$/);
  });
  it("retient la commande précédente la plus récente", () => {
    const older = { ...past, id: "old", created_at: "2026-10-01T08:00:00Z" };
    expect(findSimilarIn(cand(), [older, past])?.order.id).toBe(past.id);
  });
});

/* ------------------------------- Formulaire ------------------------------- */

const createOrder = vi.fn();
const findSimilarOrder = vi.fn();

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
  allocateToOr: vi.fn(), createOrder: (...a: unknown[]) => createOrder(...a), findSimilarOrder: (...a: unknown[]) => findSimilarOrder(...a),
  findOrByNumber: vi.fn().mockResolvedValue(null), findStockByRef: vi.fn().mockResolvedValue([]),
  listOrders: vi.fn().mockResolvedValue([]), openRegularization: vi.fn(),
}));
vi.mock("@/lib/refbase", () => ({ findRefVehicleByPlate: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supplier-docs", () => ({ ORDER_DOC_TYPE: "supplier_order", uploadSupplierDoc: vi.fn(), findExistingSupplierDocId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-docs", () => ({ linkDocToOrder: vi.fn() }));

import { OrderForm } from "@/routes/pieces-achats.commandes";

afterEach(() => { cleanup(); createOrder.mockReset(); findSimilarOrder.mockReset(); });

function renderForm() {
  return render(<OrderForm doc={null} docSite={null} initialSupplier="districash" onDone={() => undefined} />);
}

async function addLine() {
  fireEvent.click(screen.getByText("+ Ligne"));
  fireEvent.change(screen.getByLabelText("Référence"), { target: { value: "16764" } });
}
const hit = { order: { ...past, suppliers: { name: "DISTRICASH" }, repair_orders: null }, lines: past.part_order_lines!, sameDocument: false, sameSupplierRef: true };

describe("Commander des pièces — commande similaire", () => {
  it("alerte visible avec détails et lien, bouton toujours actif", async () => {
    findSimilarOrder.mockResolvedValue(hit);
    renderForm(); await addLine();
    const block = await screen.findByTestId("order-similar", {}, { timeout: 2000 });
    expect(block.textContent).toContain("même bon de commande déjà importé");
    expect(block.textContent).toContain("16764");
    expect(block.textContent).toContain("52,16");
    expect(block.textContent).toContain("qté déjà commandée 1");
    expect(block.textContent).toContain("27173596");
    expect(block.textContent).toMatch(/\d\d\/\d\d\/2026 à \d\d:\d\d/);
    expect(block.querySelector("a")!.getAttribute("href")).toBe(`/pieces-achats/commande/${past.id}`);
    expect((screen.getByText("Valider la commande") as HTMLButtonElement).disabled).toBe(false);
  });

  it("1er clic => confirmation sans création ; « Valider quand même » => nouvelle commande", async () => {
    findSimilarOrder.mockResolvedValue(hit);
    createOrder.mockResolvedValue("new-id");
    renderForm(); await addLine();
    fireEvent.click(screen.getByText("Valider la commande"));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toMatch(/Voulez-vous vraiment créer une nouvelle commande \?/);
    expect(createOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Valider quand même"));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  });

  it("« Annuler » ferme la confirmation sans créer", async () => {
    findSimilarOrder.mockResolvedValue(hit);
    renderForm(); await addLine();
    fireEvent.click(screen.getByText("Valider la commande"));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(dlg.querySelector("button")!);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("double clic rapide sans alerte => un seul createOrder", async () => {
    findSimilarOrder.mockResolvedValue(null);
    createOrder.mockImplementation(() => new Promise((r) => setTimeout(() => r("new-id"), 50)));
    renderForm(); await addLine();
    const btn = screen.getByText("Valider la commande");
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});
