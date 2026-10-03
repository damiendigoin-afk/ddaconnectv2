// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/TireTreadOverlay", () => ({ TireTreadOverlay: () => null }));

import { TourTiresAnalysis, type TourTiresRun } from "@/components/TourTiresAnalysis";
import { parseTourTiresResponse, tourTiresPrompt, TOUR_TIRE_KEYS } from "../tour-tire-analysis";
import { normalizeTireStep } from "../tire-step";

afterEach(cleanup);

const wheel = (mm: number) => ({ sidewall: { size: "205/55 R16 91V" }, wear: { pattern: "reguliere", wear_indicator: "non_visible" }, depth: { inner_mm: mm, center_mm: mm, outer_mm: mm } });
const okRun = (): TourTiresRun => ({ ok: true, results: Object.fromEntries(TOUR_TIRE_KEYS.map((k) => [k, normalizeTireStep(wheel(5.5))])) as never });

describe("Analyse groupée — lecture stricte", () => {
  it("réponse réelle EP-353-YN (hors schéma) => erreur, jamais une synthèse vide", () => {
    const real = { wheels: { pneu_avg: { sidewall: "bon", wear: "bon" }, pneu_avd: { sidewall: "bon", wear: "bon" }, pneu_arg: { sidewall: "bon", wear: "bon" }, pneu_ard: { sidewall: "bon", wear: "bon" } } };
    expect(parseTourTiresResponse(real).ok).toBe(false);
  });
  it("profondeur en tableau [g,m,d] reprise telle quelle", () => {
    const r = parseTourTiresResponse({ wheels: Object.fromEntries(TOUR_TIRE_KEYS.map((k) => [k, { depth: [5, 4.5, 4] }])) });
    expect(r.ok && r.results.pneu_avg.depth).toMatchObject({ inner_mm: 5, center_mm: 4.5, outer_mm: 4 });
  });
  it("une roue vide suffit à refuser le résultat", () => {
    const r = parseTourTiresResponse({ wheels: { pneu_avg: wheel(5), pneu_avd: wheel(5), pneu_arg: wheel(5), pneu_ard: {} } });
    expect(r.ok).toBe(false);
  });
  it("le prompt groupé embarque le schéma État pneus", () => {
    const p = tourTiresPrompt(null);
    expect(p).toContain('"inner_mm"'); expect(p).toContain('"wear_indicator"'); expect(p).toContain('"wheels"');
  });
});

describe("Écran Analyse des 4 pneus", () => {
  it("12 photos => analyse appelée une seule fois, attente, puis 4 roues", async () => {
    let resolve!: (v: TourTiresRun) => void;
    const run = vi.fn(() => new Promise<TourTiresRun>((r) => { resolve = r; }));
    render(<React.StrictMode><TourTiresAnalysis plate="EP-353-YN" tourId="t" run={run} onValidate={vi.fn()} onBack={vi.fn()} /></React.StrictMode>);
    expect(screen.getByText("Analyse IA en cours")).toBeTruthy();
    expect(screen.queryByText(/Synthèse des quatre roues/)).toBeNull();
    resolve(okRun());
    await waitFor(() => expect(screen.getByText(/Synthèse des quatre roues/)).toBeTruthy());
    expect(run).toHaveBeenCalledTimes(1);
    for (const k of TOUR_TIRE_KEYS) expect(screen.getByTestId(`wheel-${k}`)).toBeTruthy();
    expect((screen.getAllByDisplayValue("5.5")).length).toBe(12);
    expect(screen.queryByText(/devis/i)).toBeNull();
  });

  it("erreur IA => message visible + Réessayer, aucune synthèse", async () => {
    const run = vi.fn<(f: boolean) => Promise<TourTiresRun>>().mockResolvedValueOnce({ ok: false, error: "Analyse IA inexploitable pour : ARD." }).mockResolvedValueOnce(okRun());
    render(<TourTiresAnalysis plate="EP-353-YN" tourId="t" run={run} onValidate={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("inexploitable"));
    expect(screen.queryByText(/Synthèse des quatre roues/)).toBeNull();
    fireEvent.click(screen.getByText("Réessayer"));
    await waitFor(() => expect(screen.getByText(/Synthèse des quatre roues/)).toBeTruthy());
    expect(run).toHaveBeenLastCalledWith(true);
  });
});
