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

import { buildTireCorrections, preloadTireEdit } from "../tour-tire-correction";

describe("Correction de l’analyse des 4 pneus (tour clôturé)", () => {
  const step = normalizeTireStep(wheel(5.5));
  const points = TOUR_TIRE_KEYS.map((k) => ({ id: `id-${k}`, point_key: k, status: "ok", tire_analysis: { tourStep: step, corrections: [] } }));
  const initial = () => preloadTireEdit(points);

  it("mode édition : résultats préchargés, AUCUN appel IA à l’ouverture", async () => {
    const run = vi.fn(); const rerun = vi.fn();
    render(<TourTiresAnalysis plate="P" tourId="t" run={run} onValidate={vi.fn()} onBack={vi.fn()} edit={{ initial: initial(), proof: {}, rerun, onSave: vi.fn() }} />);
    expect(screen.getAllByDisplayValue("5.5").length).toBe(12);
    await new Promise((r) => setTimeout(r, 20));
    expect(run).not.toHaveBeenCalled(); expect(rerun).not.toHaveBeenCalled();
  });

  it("retour sans enregistrer n’appelle pas la sauvegarde", () => {
    const onSave = vi.fn(); const onBack = vi.fn();
    render(<TourTiresAnalysis plate="P" tourId="t" run={vi.fn()} onValidate={vi.fn()} onBack={onBack} edit={{ initial: initial(), proof: {}, rerun: vi.fn(), onSave }} />);
    fireEvent.click(screen.getByText("Retour sans enregistrer"));
    expect(onBack).toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled();
  });

  it("statut AVD OK → À remplacer sans motif : refusé", () => {
    const edits = initial(); edits.pneu_avd = { ...edits.pneu_avd!, status: "defect" };
    const r = buildTireCorrections({ points, edits, actor: { id: "u", name: "Arnaud" }, afterClosure: true });
    expect(r).toEqual({ ok: false, missingReason: ["pneu_avd"] });
  });

  it("statut AVD corrigé avec motif : mesures inchangées, historique avant/après, auteur, date", () => {
    const edits = initial(); edits.pneu_avd = { ...edits.pneu_avd!, status: "defect", reason: "Hernie flanc constatée" };
    const r = buildTireCorrections({ points, edits, actor: { id: "u", name: "Arnaud" }, afterClosure: true, now: new Date("2026-10-29T10:00:00Z") });
    if (!r.ok) throw new Error("refusé");
    expect(r.updates).toHaveLength(1);
    const u = r.updates[0]!;
    expect(u.pointId).toBe("id-pneu_avd"); expect(u.patch.status).toBe("defect"); expect(u.patch.measure_value).toBe("5.5");
    expect(u.entry).toMatchObject({ byName: "Arnaud", at: "2026-10-29T10:00:00.000Z", afterClosure: true, previous: { status: "ok" }, next: { status: "defect", depths: { inner_mm: 5.5 } } });
    expect((u.patch.tire_analysis["corrections"] as unknown[]).length).toBe(1);
  });

  it("aucune modification : rien n’est écrit", () => {
    const r = buildTireCorrections({ points, edits: initial(), actor: { id: "u", name: null }, afterClosure: true });
    expect(r).toEqual({ ok: true, updates: [] });
  });
});
