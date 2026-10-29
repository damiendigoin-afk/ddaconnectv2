// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ocr: vi.fn(), upload: vi.fn(), updates: [] as { table: string; patch: Record<string, unknown> }[],
  point: {} as Record<string, unknown>, vehicle: {} as Record<string, unknown>, media: [] as Record<string, unknown>[],
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/ocr.functions", () => ({ ocrTechnicalControl: mocks.ocr }));
vi.mock("@/lib/doc-text.browser", () => ({ localDocText: vi.fn().mockResolvedValue("Vignette CT") }));
vi.mock("@/lib/photo", () => ({
  compressImage: vi.fn(async (file: Blob) => file), blobToDataUrl: vi.fn().mockResolvedValue("data:image/jpeg;base64,dGVzdA=="),
  uploadPhoto: mocks.upload, mediaUrl: vi.fn().mockResolvedValue("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), deleteMedia: vi.fn(),
}));
vi.mock("@/components/PhotoLightbox", () => ({ useLightbox: () => ({ open: vi.fn(), node: null }) }));
vi.mock("@/lib/site-context", () => ({ useSite: () => ({ site: null }) }));
vi.mock("@tanstack/react-router", () => ({
  lazyRouteComponent: (load: () => Promise<Record<string, React.ComponentType>>, name: string) => React.lazy(async () => { const module = await load(); const component = module[name]; if (!component) throw new Error("PDF absent"); return { default: component }; }),
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ tourId: "test-tour" }) }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const result = () => {
      if (patch) {
        mocks.updates.push({ table, patch });
        Object.assign(table === "inspection_points" ? mocks.point : mocks.vehicle, patch);
        return { data: null, error: null };
      }
      if (table === "vehicle_inspections") return { data: {
        id: "test-tour", inspection_type: "guided", status: "completed", mileage: 50000,
        completed_at: "2026-10-29T12:12:00Z", vehicle: { ...mocks.vehicle }, repair_order: null,
      }, error: null };
      if (table === "inspection_points") return { data: [{ ...mocks.point }], error: null };
      if (table === "media") return { data: [...mocks.media], error: null };
      return { data: [], error: null };
    };
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      update: (value: Record<string, unknown>) => { patch = value; return builder; },
      maybeSingle: async () => ({ data: { comment: mocks.point["comment"] }, error: null }),
      single: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  },
} }));

import { TechnicalControlCard } from "@/components/TechnicalControlCard";
import { PointCard } from "@/components/PointCard";
import { fetchReport } from "@/lib/report";
import { Route as PdfRoute } from "@/routes/tour.$tourId.pdf";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.updates.length = 0; mocks.media.length = 0;
  mocks.point = { id: "test-point", point_key: "controle_technique", point_label: "Contrôle technique", zone_index: 4, zone_label: "Face avant", status: "ok", comment: "Vignette vérifiée", measure_value: null, measure_unit: null, ct_due_date: null, pollution_due_date: null };
  mocks.vehicle = { id: "test-vehicle", plate: "TEST-CT", brand: "Test", model: "Fixture", ct_due_date: null, pollution_due_date: null };
  mocks.upload.mockImplementation(async (_file: File, _folder: string, links: Record<string, unknown>) => {
    const media = { id: "test-media", storage_path: "test/ct.jpg", thumb_path: null, ...links };
    mocks.media.push(media);
    return media;
  });
  mocks.ocr.mockResolvedValue({ ok: true, json: JSON.stringify({ ct_due_date: "2028-10-29", pollution_due_date: null, vehicle_kind: "vp" }) });
  vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function show(initialCt?: string) {
  return render(<QueryClientProvider client={client}><PointCard
    point={mocks.point as unknown as React.ComponentProps<typeof PointCard>["point"]}
    inspectionId="test-tour"
    photoContent={<TechnicalControlCard pointId="test-point" tourId="test-tour" vehicleId="test-vehicle" initialCt={initialCt ?? null} />}
  /></QueryClientProvider>);
}
function choosePhoto(container: HTMLElement, imported = false) {
  const inputs = container.querySelectorAll('input[type="file"]');
  const input = inputs[imported ? 1 : 0];
  if (!input) throw new Error("Capture CT absente");
  fireEvent.change(input, { target: { files: [new File(["fixture"], "vignette.jpg", { type: "image/jpeg" })] } });
}

describe("Photo CT unifiée (données fictives, aucun appel distant)", () => {
  it("photo rattachée une seule fois → OCR → confirmation → échéance dans le vrai écran PDF, statut OK conservé", async () => {
    const { container } = show();
    choosePhoto(container);
    await screen.findByLabelText("Échéance CT lue");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledWith(expect.any(File), "tours/test-tour/controle-technique", { inspection_id: "test-tour", inspection_point_id: "test-point", label: "Contrôle technique" });
    expect(mocks.ocr).toHaveBeenCalledTimes(1);
    expect(mocks.point["ct_due_date"]).toBeNull(); // Pas de remplacement avant confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l’échéance" }));
    await waitFor(() => expect(mocks.point["ct_due_date"]).toBe("2028-10-29"));
    await waitFor(() => expect(screen.queryByLabelText("Échéance CT lue")).toBeNull());
    expect(mocks.vehicle["ct_due_date"]).toBe("2028-10-29");
    expect(mocks.point["status"]).toBe("ok");
    expect(mocks.updates.some(({ patch }) => "status" in patch)).toBe(false);
    expect(mocks.media).toHaveLength(1);
    expect(mocks.vehicle["ct_photo_media_id"]).toBe("test-media");
    const report = await fetchReport({ id: "test-tour" });
    expect(report.inspection.completed_at).toBe("2026-10-29T12:12:00Z");
    cleanup();
    client.setQueryData(["report", "test-tour"], report);
    const Pdf = PdfRoute.options.component;
    if (!Pdf) throw new Error("Écran PDF absent");
    const pdf = render(<QueryClientProvider client={client}><React.Suspense fallback={null}><Pdf /></React.Suspense></QueryClientProvider>);
    await waitFor(() => expect(pdf.container.textContent).toContain("CT valable jusqu'au 29/10/2028"));
    expect(pdf.container.textContent).not.toContain("Date du contrôle technique non renseignée");
  });

  it.each(["vide", "erreur", "exception"])("OCR %s : photo conservée, date existante et statut OK inchangés, correction manuelle possible", async (kind) => {
    mocks.point["ct_due_date"] = "2027-04-15"; mocks.vehicle["ct_due_date"] = "2027-04-15";
    if (kind === "vide") mocks.ocr.mockResolvedValue({ ok: true, json: '{"ct_due_date":null}' });
    if (kind === "erreur") mocks.ocr.mockResolvedValue({ ok: false, error: "Illisible" });
    if (kind === "exception") mocks.ocr.mockRejectedValue(new Error("Lecture indisponible"));
    const { container } = show("2027-04-15");
    choosePhoto(container, true);
    await waitFor(() => expect((screen.getByLabelText("Prochaine échéance CT") as HTMLInputElement).disabled).toBe(false));
    await screen.findByRole("status");
    expect(mocks.media).toHaveLength(1);
    expect(mocks.point["ct_due_date"]).toBe("2027-04-15");
    expect(mocks.vehicle["ct_due_date"]).toBe("2027-04-15");
    expect(mocks.point["status"]).toBe("ok");
    fireEvent.change(screen.getByLabelText("Prochaine échéance CT"), { target: { value: "2028-05-20" } });
    await waitFor(() => expect(mocks.point["ct_due_date"]).toBe("2028-05-20"));
    expect(mocks.vehicle["ct_due_date"]).toBe("2028-05-20");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("saisie manuelle sans nouvelle photo : point et véhicule enregistrés, aucun OCR", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Prochaine échéance CT"), { target: { value: "2027-12-10" } });
    await waitFor(() => expect(mocks.point["ct_due_date"]).toBe("2027-12-10"));
    expect(mocks.vehicle["ct_due_date"]).toBe("2027-12-10");
    expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("correction de la date proposée avant confirmation : provenance manuelle", async () => {
    const { container } = show(); choosePhoto(container);
    const proposal = await screen.findByLabelText("Échéance CT lue");
    fireEvent.change(proposal, { target: { value: "2028-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l’échéance" }));
    await waitFor(() => expect(mocks.point["ct_due_date"]).toBe("2028-11-15"));
    expect(mocks.point["ct_source"]).toBe("manuel");
    expect(mocks.point["ct_manually_corrected"]).toBe(true);
  });
});