// @vitest-environment jsdom
/**
 * Fiche devis interne : le lien Districash ouvre la fiche produit directe et
 * aucune référence fournisseur n'est affichée ni copiable.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sites", () => ({ siteHeader: () => ({ title: "DDA", lines: [] }) }));

import { TireQuoteSheet, type TireQuoteHeader } from "@/components/TireQuoteSheet";
import { DISTRICASH_PORTAL_URL, type SevenOffer } from "@/lib/tires";

const HEADER: TireQuoteHeader = {
  site: null,
  siteLabel: "DDA Castillon",
  createdAt: "2026-10-15T10:00:00Z",
  userName: "Damien",
  size: "245/45 R20",
  quantity: 4,
  requestedBrand: null,
  customerName: null,
  plate: null,
  vehicleLabel: null,
  loadIndex: "103",
  speedIndex: "V",
};

const DIRECT = "https://districashv2.inoshop.net/catalog/product/2055516HALPIN791/4808/STD";
const REF = "8808563527390";

function offer(over: Partial<SevenOffer>): SevenOffer {
  return {
    slot: "milieu_quatre_saisons",
    kind: "gamme",
    title: "HANKOOK 4 SAISONS",
    tier: "milieu",
    season: "quatre_saisons",
    available: true,
    unavailableReason: "",
    brand: "Hankook",
    model: "Kinergy 4S2 X",
    size: "245/45R20",
    loadIndex: "103",
    speedIndex: "V",
    quantity: 4,
    unitSourceHt: 208,
    marginHt: 41.6,
    unitSellHt: 249.6,
    tiresHt: 998.4,
    tiresTtc: 1198.08,
    mountLabel: "Montage",
    mountTtc: 81.6,
    totalHt: 1066.4,
    totalVat: 213.28,
    totalTtc: 1279.68,
    availability: "J+",
    compatibility: "compatible",
    compatibilityMessage: "",
    supplier: "districash",
    supplierRef: REF,
    consultedAt: "2026-10-15T10:00:00Z",
    offerId: null,
    productUrl: DIRECT,
    ...over,
  };
}

afterEach(cleanup);

describe("lien Districash dans la fiche devis", () => {
  it("interne : ouvre la fiche produit directe, sans référence ni bouton copier", () => {
    render(<TireQuoteSheet header={HEADER} offers={[offer({})]} internal />);
    const link = screen.getByRole("link", { name: /Voir chez Districash/ });
    expect(link.getAttribute("href")).toBe(DIRECT);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: /Copier/ })).toBeNull();
    expect(document.body.textContent).not.toContain(REF);
    expect(document.body.textContent).not.toContain("Copier");
  });

  it("interne : sans URL directe, accueil du portail et toujours aucun bouton copier", () => {
    render(<TireQuoteSheet header={HEADER} offers={[offer({ productUrl: null })]} internal />);
    const link = screen.getByRole("link", { name: /Ouvrir Districash/ });
    expect(link.getAttribute("href")).toBe(DISTRICASH_PORTAL_URL);
    expect(screen.queryByRole("button", { name: /Copier/ })).toBeNull();
    expect(document.body.textContent).not.toContain(REF);
  });

  it("vue client : ni lien, ni fournisseur, ni référence", () => {
    render(<TireQuoteSheet header={HEADER} offers={[offer({})]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).not.toContain(REF);
    expect(document.body.textContent).not.toContain("districash");
  });
});
