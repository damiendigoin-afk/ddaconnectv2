// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ lookup: vi.fn(), save: vi.fn(), search: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/ixellio.functions", () => ({ lookupIxellioVehicle: m.lookup, saveIxellioVehicle: m.save }));
vi.mock("@/lib/refbase", () => ({ universalSearch: m.search, customerName: () => "", vehicleLabel: () => "" }));
vi.mock("@/lib/winmotor/wm-data", () => ({ searchInvoices: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/site-context", () => ({ useSite: () => ({ sites: [] }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { IxellioVehicleLookup } from "@/components/IxellioVehicleLookup";
import { UniversalSearch, unknownPlateOf } from "@/components/UniversalSearch";
import { clearIxellioLookupCache } from "@/lib/ixellio-lookup-cache";
import { wellFormedPlate } from "@/lib/plate";

const found = { ok: true, outcome: "auth_ok_vehicle_found", message: "ok", vehicle: { marque: "CITROEN", modele: "C4", dateMec: "12/03/2019", vin: "VF7XXXXXXXXXXXXXX" }, detectedFields: ["marque", "modele", "dateMec", "vin"], fieldCount: 4 };
const empty = { vehicles: [], customers: [], orders: [], cases: [] };
const home = (p: string) => <IxellioVehicleLookup key={p} plate={p} variant="home" renderSaved={(id) => <span>actions {id}</span>} />;

beforeEach(() => { vi.clearAllMocks(); clearIxellioLookupCache(); });
afterEach(cleanup);

describe("normalisation", () => {
  it("espaces, tirets et casse", () => {
    expect(wellFormedPlate(" cf-025 sw ")).toBe("CF025SW");
    expect(wellFormedPlate("123 abc 24")).toBe("123ABC24");
    expect(wellFormedPlate("CF-02")).toBeNull();
    expect(wellFormedPlate("17330")).toBeNull();
    expect(wellFormedPlate("DUPONT")).toBeNull();
  });
  it("connue => null, inconnue => plaque", () => {
    const res = { ...empty, vehicles: [{ registration_normalized: "CF025SW" }] } as never;
    expect(unknownPlateOf("cf 025-sw", res)).toBeNull();
    expect(unknownPlateOf("AB-123-CD", res)).toBe("AB123CD");
  });
});

describe("accueil", () => {
  it("immat connue : aucune proposition ni appel Ixellio", async () => {
    m.search.mockResolvedValue({ ...empty, vehicles: [{ id: "v1", registration_normalized: "CF025SW", registration_display: "CF-025-SW", customer: null }] });
    render(<UniversalSearch renderUnknownPlate={home} />);
    fireEvent.change(screen.getByLabelText("Recherche client ou véhicule"), { target: { value: "cf-025-sw" } });
    await screen.findByText("CF-025-SW");
    expect(screen.queryByText("Véhicule non trouvé dans DDA Connect")).toBeNull();
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it("immat inconnue : proposition, sans appel automatique", async () => {
    m.search.mockResolvedValue(empty);
    render(<UniversalSearch renderUnknownPlate={home} />);
    fireEvent.change(screen.getByLabelText("Recherche client ou véhicule"), { target: { value: "ab 123 cd" } });
    await screen.findByText("Véhicule non trouvé dans DDA Connect");
    expect(screen.getByText("Rechercher avec Ixellio")).toBeTruthy();
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it("immat mal formée : rien", async () => {
    m.search.mockResolvedValue(empty);
    render(<UniversalSearch renderUnknownPlate={home} />);
    fireEvent.change(screen.getByLabelText("Recherche client ou véhicule"), { target: { value: "AB12" } });
    await screen.findByText("Aucun résultat.");
    expect(screen.queryByText("Rechercher avec Ixellio")).toBeNull();
  });
});

describe("fiche Ixellio", () => {
  it("succès : champs renvoyés seulement ; double clic = 1 appel ; création après clic uniquement", async () => {
    let resolve!: (v: unknown) => void;
    m.lookup.mockReturnValue(new Promise((r) => (resolve = r)));
    m.save.mockResolvedValue({ id: "veh-1", storedFields: 4 });
    render(home("AB123CD"));
    const btn = screen.getByText("Rechercher avec Ixellio");
    fireEvent.click(btn); fireEvent.click(btn);
    expect(m.lookup).toHaveBeenCalledTimes(1);
    await act(async () => resolve(found));
    expect(await screen.findByText("CITROEN")).toBeTruthy();
    expect(screen.getByText("12/03/2019")).toBeTruthy();
    expect(screen.queryByText("Énergie")).toBeNull();
    expect(screen.queryByText("Carburant")).toBeNull();
    expect(m.save).not.toHaveBeenCalled();
    const saveBtn = screen.getByText("Enregistrer ce véhicule dans DDA Connect");
    fireEvent.click(saveBtn); fireEvent.click(saveBtn);
    await screen.findByText("actions veh-1");
    expect(m.save).toHaveBeenCalledTimes(1);
  });
  it("cache de session : même immat => pas de 2e appel", async () => {
    m.lookup.mockResolvedValue(found);
    const { unmount } = render(home("AB123CD"));
    fireEvent.click(screen.getByText("Rechercher avec Ixellio"));
    await screen.findByText("CITROEN"); unmount();
    render(home("AB123CD"));
    fireEvent.click(screen.getByText("Rechercher avec Ixellio"));
    await screen.findByText("CITROEN");
    expect(m.lookup).toHaveBeenCalledTimes(1);
  });
  it("aucun résultat : message + Réessayer", async () => {
    m.lookup.mockResolvedValue({ ok: false, outcome: "auth_ok_no_vehicle", message: "Aucun véhicule trouvé.", vehicle: {} });
    render(home("AB123CD"));
    fireEvent.click(screen.getByText("Rechercher avec Ixellio"));
    expect(await screen.findByText("Aucun véhicule trouvé.")).toBeTruthy();
    expect(screen.getByText("Réessayer")).toBeTruthy();
  });
  it("erreur réseau puis auth : message, réessai non mis en cache", async () => {
    m.lookup.mockRejectedValueOnce(new Error("Réseau indisponible"))
      .mockResolvedValueOnce({ ok: false, outcome: "auth_refused", message: "Identifiants refusés.", vehicle: {} });
    render(home("AB123CD"));
    fireEvent.click(screen.getByText("Rechercher avec Ixellio"));
    await screen.findByText("Réseau indisponible");
    fireEvent.click(screen.getByText("Réessayer"));
    await screen.findByText("Identifiants refusés.");
    expect(m.lookup).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(m.save).not.toHaveBeenCalled());
  });
});
