// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ savePressure: vi.fn(), pending: new Map<string, boolean>() }));
vi.mock("@/lib/tour-tire-persistence", () => ({
  saveTourTirePressureChecked: mocks.savePressure,
  pendingTirePressure: (id: string) => mocks.pending.get(id),
  queueTirePressure: (id: string, v: boolean) => mocks.pending.set(id, v),
  flushPendingTirePressure: async () => 0,
}));
vi.mock("@/components/BurstCamera", () => ({ BurstCamera: () => null }));
vi.mock("@/components/PhotoManager", () => ({ PhotoManager: () => null, MediaThumb: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TourTireCapture } from "@/components/TourTireCapture";
import { TirePressureSummary } from "@/components/ReportView";

const keys = ["pneu_avg", "pneu_avd", "pneu_arg", "pneu_ard"] as const;
const label = (key: string) => key.replace("pneu_", "Pneu ").toUpperCase();
const point = (key: string, tire_analysis?: unknown) => ({
  id: `id-${key}`, point_key: key, point_label: label(key), status: "unset", measure_value: null, measure_unit: null, comment: null,
  ...(tire_analysis === undefined ? {} : { tire_analysis }),
});
const group = (key: string) => screen.getByRole("radiogroup", { name: `Pression — ${label(key)}` });
const choice = (key: string, name: "Pression contrôlée" | "Non contrôlée") => within(group(key)).getByRole("radio", { name });

beforeEach(() => { mocks.savePressure.mockReset(); mocks.pending.clear(); });
afterEach(cleanup);

describe("TDV guidé — question pression sur les quatre roues", () => {
  it("non renseignée par défaut, réponses indépendantes par roue, retrouvées au rechargement", async () => {
    const stored = new Map<string, unknown>();
    mocks.savePressure.mockImplementation(async (id: string, checked: boolean) => {
      const key = id.replace("id-", "");
      stored.set(key, { ...((stored.get(key) as object) ?? {}), confirmedRef: "205/55 R16 91V", pressure_checked: checked });
    });
    const points = () => keys.map((key) => point(key, stored.get(key)));
    const view = render(<>{points().map((p) => <TourTireCapture key={p.id} point={p} inspectionId="tour" />)}</>);
    for (const key of keys) {
      expect(choice(key, "Pression contrôlée").getAttribute("aria-checked")).toBe("false");
      expect(choice(key, "Non contrôlée").getAttribute("aria-checked")).toBe("false");
    }
    fireEvent.click(choice("pneu_avg", "Pression contrôlée"));
    await waitFor(() => expect(choice("pneu_avg", "Pression contrôlée").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(choice("pneu_arg", "Non contrôlée"));
    await waitFor(() => expect(choice("pneu_arg", "Non contrôlée").getAttribute("aria-checked")).toBe("true"));
    expect(mocks.savePressure.mock.calls).toEqual([["id-pneu_avg", true], ["id-pneu_arg", false]]);
    expect(stored.has("pneu_avd")).toBe(false);
    expect(stored.has("pneu_ard")).toBe(false);

    view.unmount();
    render(<>{points().map((p) => <TourTireCapture key={p.id} point={p} inspectionId="tour" />)}</>);
    expect(choice("pneu_avg", "Pression contrôlée").getAttribute("aria-checked")).toBe("true");
    expect(choice("pneu_arg", "Non contrôlée").getAttribute("aria-checked")).toBe("true");
    for (const key of ["pneu_avd", "pneu_ard"]) {
      expect(choice(key, "Pression contrôlée").getAttribute("aria-checked")).toBe("false");
      expect(choice(key, "Non contrôlée").getAttribute("aria-checked")).toBe("false");
    }
  });

  it("une erreur de sauvegarde en ligne est visible et ne simule pas une réponse enregistrée", async () => {
    mocks.savePressure.mockRejectedValue(new Error("refus"));
    render(<TourTireCapture point={point("pneu_arg", { ai: { depth_mm: 4 } })} inspectionId="tour" />);
    fireEvent.click(choice("pneu_arg", "Pression contrôlée"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("n’a pas été enregistrée"));
    expect(choice("pneu_arg", "Pression contrôlée").getAttribute("aria-checked")).toBe("false");
  });

  it("hors réseau : la réponse est gardée sur l’appareil pour cette seule roue", async () => {
    mocks.savePressure.mockRejectedValue(new TypeError("Failed to fetch"));
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<TourTireCapture point={point("pneu_ard")} inspectionId="tour" />);
    fireEvent.click(choice("pneu_ard", "Non contrôlée"));
    await waitFor(() => expect(screen.getByText(/Hors réseau/)).toBeTruthy());
    expect(mocks.pending.get("id-pneu_ard")).toBe(false);
    expect(mocks.pending.size).toBe(1);
    spy.mockRestore();
  });

  it("le rapport consultable distingue Oui / Non contrôlée / Non renseignée sans valeur mesurée", () => {
    const ta = (k: string) => (k === "pneu_ard" ? { pressure_checked: true } : k === "pneu_avg" ? { pressure_checked: false } : {});
    render(<TirePressureSummary points={keys.map((key) => ({ ...point(key, ta(key)), zone_index: 1, zone_label: "Pneus", client_comment: null }))} />);
    const section = screen.getByRole("region", { name: "Pression des pneus" });
    expect(within(section).getByText("Pression vérifiée : Oui")).toBeTruthy();
    expect(within(section).getByText("Pression vérifiée : Non contrôlée")).toBeTruthy();
    expect(within(section).getAllByText("Pression vérifiée : Non renseignée")).toHaveLength(2);
    expect(section.textContent).not.toMatch(/bar\b/);
  });
});
