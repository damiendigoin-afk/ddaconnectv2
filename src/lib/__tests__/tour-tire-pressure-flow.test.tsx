// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ savePressure: vi.fn() }));
vi.mock("@/lib/tour-tire-persistence", () => ({ saveTourTirePressureChecked: mocks.savePressure }));
vi.mock("@/components/BurstCamera", () => ({ BurstCamera: () => null }));
vi.mock("@/components/PhotoManager", () => ({ PhotoManager: () => null, MediaThumb: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TourTireCapture } from "@/components/TourTireCapture";
import { TirePressureSummary } from "@/components/ReportView";
import { TIRE_PRESSURE_LABEL } from "../tour-tire-pressure";

const keys = ["pneu_avg", "pneu_avd", "pneu_arg", "pneu_ard"] as const;
const point = (key: string, tire_analysis?: unknown) => ({
  id: `id-${key}`,
  point_key: key,
  point_label: key.replace("pneu_", "Pneu ").toUpperCase(),
  status: "unset",
  measure_value: null,
  measure_unit: null,
  comment: null,
  ...(tire_analysis === undefined ? {} : { tire_analysis }),
});
const checkboxName = (key: string) => `${TIRE_PRESSURE_LABEL} — ${key.replace("pneu_", "Pneu ").toUpperCase()}`;

beforeEach(() => {
  mocks.savePressure.mockReset();
});
afterEach(cleanup);

describe("TDV guidé — quatre coches indépendantes", () => {
  it("décoche par défaut, enregistre seulement AVG puis retrouve les quatre états au rechargement", async () => {
    const stored = new Map<string, unknown>();
    mocks.savePressure.mockImplementation(async (id: string, checked: boolean) => {
      const key = id.replace("id-", "");
      stored.set(key, { ...(stored.get(key) as object ?? {}), confirmedRef: key === "pneu_avg" ? "205/55 R16 91V" : null, pressure_checked: checked });
    });
    const points = () => keys.map((key) => point(key, stored.get(key)));
    const view = render(<>{points().map((p) => <TourTireCapture key={p.id} point={p} inspectionId="tour" />)}</>);

    for (const key of keys) {
      expect((screen.getByRole("checkbox", { name: checkboxName(key) }) as HTMLInputElement).checked).toBe(false);
      expect((screen.getAllByRole("button", { name: "Photographier le pneu (3 photos)" })[0] as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole("checkbox", { name: checkboxName("pneu_avg") }));
    await waitFor(() => expect(mocks.savePressure).toHaveBeenCalledWith("id-pneu_avg", true));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: checkboxName("pneu_avg") }) as HTMLInputElement).checked).toBe(true));
    expect(mocks.savePressure).toHaveBeenCalledTimes(1);
    expect(stored.get("pneu_avg")).toMatchObject({ confirmedRef: "205/55 R16 91V", pressure_checked: true });
    expect(stored.has("pneu_avd")).toBe(false);
    expect(stored.has("pneu_arg")).toBe(false);
    expect(stored.has("pneu_ard")).toBe(false);

    view.unmount();
    render(<>{points().map((p) => <TourTireCapture key={p.id} point={p} inspectionId="tour" />)}</>);
    expect((screen.getByRole("checkbox", { name: checkboxName("pneu_avg") }) as HTMLInputElement).checked).toBe(true);
    for (const key of keys.slice(1)) {
      expect((screen.getByRole("checkbox", { name: checkboxName(key) }) as HTMLInputElement).checked).toBe(false);
    }
  });

  it("une erreur de sauvegarde est visible et ne simule pas une coche enregistrée", async () => {
    mocks.savePressure.mockRejectedValue(new Error("réseau indisponible"));
    render(<TourTireCapture point={point("pneu_arg", { ai: { depth_mm: 4 } })} inspectionId="tour" />);
    const checkbox = screen.getByRole("checkbox", { name: checkboxName("pneu_arg") }) as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("n’a pas été enregistrée"));
    expect(checkbox.checked).toBe(false);
  });

  it("le rapport consultable mentionne Oui ou Non confirmée pour chacune des quatre roues", () => {
    render(<TirePressureSummary points={keys.map((key) => ({ ...point(key, { pressure_checked: key === "pneu_ard" }), zone_index: 1, zone_label: "Pneus", client_comment: null }))} />);
    const section = screen.getByRole("region", { name: "Pression des pneus" });
    expect(within(section).getAllByText("Pression vérifiée : Non confirmée")).toHaveLength(3);
    expect(within(section).getByText("Pression vérifiée : Oui")).toBeTruthy();
    for (const key of keys) expect(within(section).getByText(new RegExp(key.replace("pneu_", "Pneu ").toUpperCase()))).toBeTruthy();
  });
});
