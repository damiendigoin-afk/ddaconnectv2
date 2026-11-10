import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("../ixellio.functions", () => ({ lookupIxellioVehicle: vi.fn() }));
vi.mock("../or-scan-log.functions", () => ({ recordOrScan: vi.fn(), finalizeOrScan: vi.fn() }));

import { ctStatusLine, isCtConfirmed, mergeCtComment, reportCtStatus } from "../ct";
import { clearIxellioLookupCache } from "../ixellio-lookup-cache";
import { scanIxellio } from "../or-scan-flow";
import { assessOrScan } from "../or-scan-validate";
import { buildDatesPatch } from "../vehicle-dates-edit";
import { crossIxellio, ctStatus, firstCtTheoretical, guardFirstRegistration, validateVehicleDates } from "../vehicle-dates";

const TODAY = "2026-11-10";
const found = (vehicle: Record<string, string>) => ({ ok: true, outcome: "auth_ok_vehicle_found", message: "", vehicle });

describe("HG-714-NQ — MEC vs date de livraison", () => {
  const read = { client: { last_name: "X" }, vehicle: { plate: "HG-714-NQ", vin: "VF1RHN00774040932", first_registration: "2026-07-18", delivery_date: "2026-07-18" }, order: { or_number: "17413" } };

  it("une MEC égale à la date de livraison est retirée et signalée", () => {
    const a = assessOrScan({ data: read, orNumber: "17413" });
    expect(a.data.vehicle["first_registration"]).toBeNull();
    expect(a.doubts.map((d) => d.code)).toContain("mec_is_delivery");
    expect(guardFirstRegistration({ first_registration: "2026-07-18", delivery_at: "2026-07-18T17:00", today: TODAY }).rejected).toBe("delivery");
    expect(guardFirstRegistration({ first_registration: "2025-06-30", delivery_date: "2026-07-18", today: TODAY })).toEqual({ first_registration: "2025-06-30", rejected: null });
  });

  it("Ixellio complète la MEC absente (VIN identique)", async () => {
    clearIxellioLookupCache();
    const a = assessOrScan({ data: read, orNumber: "17413" });
    const run = vi.fn().mockResolvedValue(found({ dateMec: "30/06/2025", vin: "VF1RHN00774040932", marque: "RENAULT" }));
    const r = await scanIxellio(a.data, "17413", run);
    expect(run).toHaveBeenCalledWith("HG714NQ");
    expect(r.cross.mec).toBe("fill");
    expect(r.cross.ixMec).toBe("2025-06-30");
    expect(r.doubts).toEqual([]);
    // Cache anti-doublon : pas de 2e appel pour la même plaque.
    await scanIxellio(a.data, "17413", run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("MEC lue différente de la MEC Ixellio : arbitrage bloquant, pas d'écrasement", () => {
    const c = crossIxellio({ vin: "VF1RHN00774040932", first_registration: "2024-01-02" }, found({ dateMec: "30/06/2025", vin: "VF1RHN00774040932" }));
    expect(c.mec).toBe("conflict");
  });

  it("VIN divergent : enrichissement stoppé et validation exigée", async () => {
    clearIxellioLookupCache();
    const run = vi.fn().mockResolvedValue(found({ dateMec: "30/06/2025", vin: "VF1AAAAAA00000001" }));
    const r = await scanIxellio({ ...read, vehicle: { ...read.vehicle, first_registration: null } }, "17413", run);
    expect(r.cross.vinMismatch).toBe(true);
    expect(r.cross.mec).toBe("none");
    expect(r.doubts.find((d) => d.code === "ixellio_vin_mismatch")?.blocking).toBe(true);
  });

  it("Ixellio 403 / délai / erreur : le scan continue avec un statut non bloquant", async () => {
    clearIxellioLookupCache();
    const r1 = await scanIxellio(read, "17413", vi.fn().mockResolvedValue({ ok: false, outcome: "auth_forbidden", message: "403", vehicle: {} }));
    expect(r1.cross.status).toBe("unavailable");
    expect(r1.doubts.every((d) => !d.blocking)).toBe(true);
    clearIxellioLookupCache();
    const r3 = await scanIxellio(read, "17413", vi.fn().mockRejectedValue(new Error("network")));
    expect(r3.cross.status).toBe("unavailable");
    clearIxellioLookupCache();
    const r2 = await scanIxellio(read, "17413", () => new Promise(() => undefined), 20);
    expect(r2.cross.status).toBe("unavailable");
  });

  it("plaque non valide : Ixellio n'est pas interrogé", async () => {
    const run = vi.fn();
    const r = await scanIxellio({ ...read, vehicle: { plate: "17413" } }, "17413", run);
    expect(run).not.toHaveBeenCalled();
    expect(r.cross.status).toBe("skipped");
  });
});

describe("Premier CT théorique (VP/VUL)", () => {
  it("MEC 30/06/2025 => avant fin juin 2029, limite 29/06/2029", () => {
    expect(firstCtTheoretical("2025-06-30")).toEqual({ limit: "2029-06-29", windowStart: "2028-12-30", label: "Premier CT à réaliser avant fin juin 2029" });
    const st = ctStatus({ mec: "2025-06-30", vehicleType: "VP", today: TODAY });
    expect(st.kind).toBe("theoretical");
    expect(st.headline).toBe("Premier CT à réaliser avant fin juin 2029");
    expect(st.headline).not.toMatch(/valable/);
  });

  it("29/02 : date civile déterministe", () => {
    expect(firstCtTheoretical("2024-02-29")?.limit).toBe("2028-02-28");
  });

  it("CT réel confirmé jamais remplacé par la théorie", () => {
    expect(ctStatus({ ctDue: "2030-05-01", ctSource: "manuel", mec: "2025-06-30", vehicleType: "VP", today: TODAY }).kind).toBe("verified");
  });

  it("véhicule de plus de 4 ans sans CT : pas de formule MEC+4", () => {
    const st = ctStatus({ mec: "2015-01-01", vehicleType: "VP", today: TODAY });
    expect(st.kind).toBe("missing");
    expect(st.detail).toMatch(/2 ans/);
  });

  it("catégories spéciales (CAM, VASP…) exclues ; inconnue = à confirmer", () => {
    expect(ctStatus({ mec: "2025-06-30", vehicleType: "VASP", today: TODAY }).kind).toBe("missing");
    expect(ctStatus({ mec: "2025-06-30", vehicleType: "CAM", today: TODAY }).kind).toBe("missing");
    const u = ctStatus({ mec: "2025-06-30", vehicleType: null, today: TODAY });
    expect(u.kind === "theoretical" && !u.categoryConfirmed).toBe(true);
  });

  it("source « theorique » : confirmation du tour acceptée sans photo, sans date", () => {
    expect(isCtConfirmed({ ct_read_at: "2026-11-10", ct_source: "theorique", ct_due_date: null })).toBe(true);
    expect(isCtConfirmed({ ct_read_at: null, ct_source: "theorique" })).toBe(false);
  });
});

describe("Correction manuelle depuis un tour terminé (HG-714-NQ)", () => {
  const comment = "Pare-brise impacté côté passager.\nContrôle technique valable jusqu'au 10/11/2029.";

  it("MEC corrigée + CT théorique : commentaire auto recalculé, constat libre conservé", () => {
    const patch = buildDatesPatch({
      before: { first_registration: "2026-07-18", delivery_date: "2026-07-18" },
      mec: "2025-06-30", delivery: "2026-07-18", ctMode: "theoretical", ct: null, proof: null,
      ctComment: (a) => mergeCtComment(comment, a.ct, null, a.theoretical), vehicleType: null, currentCt: "2026-11-10", today: TODAY,
    });
    expect(patch).toMatchObject({ ct_mode: "theoretical", first_registration: "2025-06-30", first_registration_source: "manuel" });
    expect(patch["delivery_date"]).toBeUndefined();
    expect(patch["ct_comment"]).toBe("Pare-brise impacté côté passager.\nPremier CT à réaliser avant fin juin 2029 (limite théorique 29/06/2029, non attestée).");
    expect(String(patch["ct_comment"])).not.toMatch(/2029\.$|10\/11\/2029/);
  });

  it("aperçu / PDF : même statut après correction (théorique vs vérifié)", () => {
    const after = { vehicle: { ct_due_date: null, ct_source: "theorique", first_registration: "2025-06-30", vehicle_type: null }, points: [{ point_key: "controle_technique", ct_due_date: null, ct_source: "theorique" }] };
    expect(ctStatusLine(reportCtStatus(after, TODAY))).toBe("Premier CT à réaliser avant fin juin 2029 (limite théorique 29/06/2029, non attestée)");
    const real = { vehicle: { ct_due_date: "2028-03-01", ct_source: "manuel", first_registration: "2020-03-01" }, points: [] };
    expect(ctStatusLine(reportCtStatus(real, TODAY))).toBe("CT valable jusqu'au 01/03/2028");
  });

  it("date réelle : preuve transmise ; validation des dates", () => {
    const patch = buildDatesPatch({ before: { first_registration: "2025-06-30", delivery_date: null }, mec: "2025-06-30", delivery: null, ctMode: "real", ct: "2029-06-20", proof: "pv", ctComment: null, vehicleType: "VP", currentCt: null });
    expect(patch).toEqual({ ct_mode: "real", ct_due_date: "2029-06-20", ct_proof: "pv" });
    expect(validateVehicleDates({ first_registration: "2030-01-01" }, TODAY)).toMatch(/passée/);
    expect(validateVehicleDates({ first_registration: "2025-06-30", ct_due_date: "2025-01-01" }, TODAY)).toMatch(/postérieure/);
    expect(validateVehicleDates({ first_registration: "2025-06-30", delivery_date: "2026-07-18" }, TODAY)).toBeNull();
  });
});
