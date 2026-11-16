// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOrScanConfirm } from "@/components/OrScanConfirm";
import { crossIxellio } from "@/lib/vehicle-dates";
import type { OrScanData } from "@/lib/or-scan-validate";

const found = (v: Record<string, string>) => ({ outcome: "auth_ok_vehicle_found", vehicle: v });
let api: ReturnType<typeof useOrScanConfirm> | null = null;
function Host() { api = useOrScanConfirm(); return <>{api.dialog}</>; }

function open(data: OrScanData, ix: ReturnType<typeof crossIxellio>, doubts = [] as never[]) {
  render(<Host />);
  let p!: Promise<OrScanData | null>;
  act(() => { p = api!.confirm(data, doubts, "17500", ix); });
  return { p };
}
const base = (v: Record<string, unknown>): OrScanData => ({
  vehicle: { plate: "GM-634-SG", brand: "DACIA", model: "SPRING", mileage: "41200", delivery_date: "2026-07-18", ...v },
  client: { last_name: "MARTIN", phone: "0600000000" }, order: { or_number: "17500" },
});
const validate = () => fireEvent.click(screen.getByRole("button", { name: "Valider et continuer" }));

afterEach(() => { cleanup(); api = null; });

describe("OrScanConfirm — parcours", () => {
  const vehicle = { vin: "UU1DBG00XNU086299", first_registration: "2023-03-15" };
  const ix = crossIxellio(vehicle, found({ vin: "UU1DBG00XNU086243", dateMec: "16/03/2023", marque: "DACIA", modele: "SPRING ELECTRIQUE" }));

  it("vrai désaccord : choix obligatoire, puis Ixellio appliqué sans case générique", async () => {
    const { p } = open(base(vehicle), ix);
    expect(screen.queryByText(/J'ai vérifié ces valeurs/)).toBeNull();
    validate();
    expect(screen.getByRole("alert").textContent).toMatch(/choisissez la source/);
    fireEvent.click(screen.getByRole("radio", { name: /Utiliser les données Ixellio/ }));
    expect(screen.getByText("Source retenue : Ixellio.")).toBeTruthy();
    expect(screen.queryByText(/enrichissement stoppé/)).toBeNull();
    validate();
    const r = await p;
    expect(r?.vehicle).toMatchObject({ vin: "UU1DBG00XNU086243", vin_source: "ixellio", first_registration: "2023-03-16", first_registration_source: "ixellio", model: "SPRING ELECTRIQUE", mileage: "41200", delivery_date: "2026-07-18" });
    expect(r?.client).toMatchObject({ last_name: "MARTIN", phone: "0600000000" });
    expect(screen.queryByText(/J'ai vérifié ces valeurs/)).toBeNull();
  });

  it("vrai désaccord : choix scan OR, aucune donnée Ixellio", async () => {
    const { p } = open(base(vehicle), ix);
    fireEvent.click(screen.getByRole("radio", { name: /Conserver les données du scan OR/ }));
    validate();
    const r = await p;
    expect(r?.vehicle).toMatchObject({ vin: "UU1DBG00XNU086299", vin_source: "ocr_or", first_registration: "2023-03-15", model: "SPRING" });
  });

  it("conflit MEC seul : correction manuelle suffit", async () => {
    const v = { vin: "UU1DBG00XNU086243", first_registration: "2023-03-15" };
    const c = crossIxellio(v, found({ vin: "UU1DBG00XNU086243", dateMec: "16/03/2023" }));
    expect(c.mec).toBe("conflict");
    const { p } = open(base(v), c);
    expect(screen.getByRole("radio", { name: /Utiliser la MEC Ixellio/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Conserver la MEC du scan OR/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/1re mise en circulation/), { target: { value: "2023-03-17" } });
    expect(screen.getByText("MEC retenue : saisie manuelle.")).toBeTruthy();
    validate();
    const r = await p;
    expect(r?.vehicle).toMatchObject({ first_registration: "2023-03-17", first_registration_source: "manuel" });
  });

  it("O/0 corrigé en amont : pas de choix, correction affichée via vin_ocr_raw", async () => {
    const v = { vin: "UU1DBG00XNU086243", vin_ocr_raw: "UU1DBGOOXNU086243", first_registration: "2023-03-15" };
    const c = crossIxellio(v, found({ vin: "UU1DBG00XNU086243", dateMec: "15/03/2023" }));
    expect(c.vinMismatch).toBe(false);
    expect(c.readVinRaw).toBe("UU1DBGOOXNU086243");
    const { p } = open(base(v), c);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/O corrigé en 0/)).toBeTruthy();
    validate();
    const r = await p;
    expect(r?.vehicle).toMatchObject({ vin: "UU1DBG00XNU086243", vin_ocr_raw: "UU1DBGOOXNU086243" });
  });
});
