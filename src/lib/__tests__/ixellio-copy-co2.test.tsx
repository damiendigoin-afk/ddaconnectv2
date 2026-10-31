// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ lookup: vi.fn(), save: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/ixellio.functions", () => ({ lookupIxellioVehicle: m.lookup, saveIxellioVehicle: m.save }));
vi.mock("sonner", () => ({ toast: m.toast }));

import { IxellioVehicleLookup } from "@/components/IxellioVehicleLookup";
import { ixellioCopyText, ixellioDisplayValue } from "@/lib/ixellio-copy";
import { clearIxellioLookupCache } from "@/lib/ixellio-lookup-cache";
import { ixellioToRefFields } from "@/lib/ixellio-map";
import { parseIxellioHtml } from "@/lib/ixellio-parse";

const row = (l: string, v: string) => `<table><tr><td>Marque</td><td>FORD</td></tr><tr><td>${l}</td><td>${v}</td></tr></table>`;
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => { vi.clearAllMocks(); clearIxellioLookupCache(); Object.assign(navigator, { clipboard: { writeText } }); });
afterEach(cleanup);

describe("mapping CO2", () => {
  it.each([["CO2", "127"], ["Émissions de CO2 (g/km)", "127 g/km"], ["CO2 WLTP", "127"], ["Taux de CO2", "127"], ["V.7", "127"], ["Rejet CO2 NEDC", "98"]])("%s reconnu", (l, v) => {
    expect(parseIxellioHtml(row(l, v)).vehicle.co2).toBe(v);
  });
  it("cycle seulement si fourni", () => {
    expect(parseIxellioHtml(row("CO2 WLTP", "127")).vehicle.co2Cycle).toBe("WLTP");
    expect(parseIxellioHtml(row("CO2", "127")).vehicle.co2Cycle).toBeUndefined();
  });
  it("absent : aucune valeur, libellé inconnu remonté en diagnostic", () => {
    const r = parseIxellioHtml(row("Norme euro", "6.2"));
    expect(r.vehicle.co2).toBeUndefined();
    expect(ixellioToRefFields(r.vehicle).co2_g_km).toBeNull();
    expect(r.unmatchedLabels).toContain("norme euro");
  });
  it("valeur non numérique rejetée", () => {
    expect(parseIxellioHtml(row("CO2", "NC")).vehicle.co2).toBeUndefined();
  });
  it("affichage g/km + cycle, sauvegarde entier", () => {
    expect(ixellioDisplayValue("co2", { co2: "127", co2Cycle: "WLTP" })).toBe("127 g/km (WLTP)");
    expect(ixellioDisplayValue("co2", { co2: "127 g/km" })).toBe("127 g/km");
    expect(ixellioToRefFields({ co2: "127 g/km" }).co2_g_km).toBe(127);
  });
});

describe("copie", () => {
  it("texte clair : champs présents uniquement", () => {
    const t = ixellioCopyText("GA-925-CZ", { marque: "FORD", modele: "PUMA", vin: "" }, [["marque", "Marque"], ["modele", "Modèle"], ["vin", "VIN"], ["co2", "CO2"]]);
    expect(t).toBe("Immatriculation : GA-925-CZ\nMarque : FORD\nModèle : PUMA");
  });
  it("boutons : valeur exacte, tout copier, enregistrement intact", async () => {
    m.lookup.mockResolvedValue({ ok: true, outcome: "auth_ok_vehicle_found", message: "", vehicle: { marque: "FORD", vin: "WF0FXXGCHFMA12345", cnit: "M10FRDVP012A345" }, fieldCount: 3 });
    m.save.mockResolvedValue({ id: "v", storedFields: 3 });
    render(<IxellioVehicleLookup plate="GA925CZ" variant="home" />);
    fireEvent.click(screen.getByText("Rechercher avec Ixellio"));
    fireEvent.click(await screen.findByLabelText("Copier VIN"));
    await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith("WF0FXXGCHFMA12345"));
    await vi.waitFor(() => expect(m.toast.success).toHaveBeenCalledWith("Copié", expect.anything()));
    fireEvent.click(screen.getByLabelText("Copier Immatriculation"));
    await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith("GA-925-CZ"));
    expect(screen.getByText("CO2 non transmis par Ixellio pour ce véhicule.")).toBeTruthy();
    expect(screen.queryByLabelText("Copier CO2")).toBeNull();
    fireEvent.click(screen.getByText("Copier toutes les caractéristiques"));
    await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Immatriculation : GA-925-CZ\nMarque : FORD\nVIN : WF0FXXGCHFMA12345\nCNIT : M10FRDVP012A345"));
    expect(m.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Enregistrer ce véhicule dans DDA Connect"));
    await screen.findByText(/Véhicule enregistré/);
    expect(m.save).toHaveBeenCalledWith({ data: { plate: "GA925CZ", vehicle: { marque: "FORD", vin: "WF0FXXGCHFMA12345", cnit: "M10FRDVP012A345" } } });
  });
});
