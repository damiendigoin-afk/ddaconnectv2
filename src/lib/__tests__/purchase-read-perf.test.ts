import { beforeEach, describe, expect, it, vi } from "vitest";

const localDocText = vi.fn(async () => "texte ocr local");
const ocr = vi.fn();
vi.mock("@/lib/doc-text.browser", () => ({ localDocText: (...a: unknown[]) => localDocText(...(a as [])) }));
vi.mock("@/lib/photo", () => ({ blobToDataUrl: async () => "data:image/jpeg;base64,AAAA", compressImage: async (b: Blob) => b }));
vi.mock("@/lib/ocr.functions", () => ({ ocrPurchaseDocument: (a: unknown) => ocr(a) }));

const insert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: (...a: unknown[]) => { insert(...a); throw new Error("insert"); }, select: () => ({}) }) },
}));

const { readPurchaseDoc, visionUnusable } = await import("../purchase-doc");
const { uploadSupplierDoc } = await import("../supplier-docs");

const GOOD = {
  doc_kind: "bl", supplier: "FOURNISSEUR TEST", delivery_note_number: "123", document_date: "2026-10-19",
  lines: [{ reference: "ABC123", label: "FILTRE", quantity: 1, unit_price: 10, amount: 10, line_kind: "part" }],
  total_ht: 10, vat_amount: 2, total_ttc: 12, read_provenance: { source: "vision", vision_initial: "ok", recheck_used: false },
};
const photo = () => new File([new Uint8Array(10)], "bl.jpg", { type: "image/jpeg" });

describe("lecture photo BL — performance", () => {
  beforeEach(() => { localDocText.mockClear(); ocr.mockReset(); insert.mockClear(); vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("vision réussie : Tesseract jamais appelé, un seul appel serveur, étapes visibles", async () => {
    ocr.mockResolvedValue({ ok: true, error: "", json: JSON.stringify(GOOD) });
    const stages: string[] = [];
    const r = await readPurchaseDoc(photo(), (s) => stages.push(s));
    expect(localDocText).not.toHaveBeenCalled();
    expect(ocr).toHaveBeenCalledTimes(1);
    expect((ocr.mock.calls[0]![0] as { data: { text?: string } }).data.text).toBeUndefined();
    expect(stages).toEqual(["prepare", "vision", "checking"]);
    expect(r.fallbackOcr).toBe(false);
    expect(r.timings?.fallback_ocr_ms).toBe(0);
  });

  it("vision en échec : Tesseract une seule fois puis secours texte sans image", async () => {
    ocr.mockResolvedValueOnce({ ok: false, error: "x", json: "" }).mockResolvedValueOnce({ ok: true, error: "", json: JSON.stringify({ ...GOOD, requires_review: true }) });
    const stages: string[] = [];
    const r = await readPurchaseDoc(photo(), (s) => stages.push(s));
    expect(localDocText).toHaveBeenCalledTimes(1);
    expect(ocr).toHaveBeenCalledTimes(2);
    const second = (ocr.mock.calls[1]![0] as { data: { fallbackOcr?: boolean; dataUrl?: string } }).data;
    expect(second.fallbackOcr).toBe(true);
    expect(second.dataUrl).toBeUndefined();
    expect(stages).toContain("fallback_ocr");
    expect(r.extracted.requires_review).toBe(true);
  });

  it("vision incohérente avec relecture serveur : pas de Tesseract en plus", async () => {
    ocr.mockResolvedValue({ ok: true, error: "", json: JSON.stringify({ ...GOOD, requires_review: true, read_provenance: { vision_initial: "ok", recheck_used: true } }) });
    await readPurchaseDoc(photo());
    expect(localDocText).not.toHaveBeenCalled();
    expect(ocr).toHaveBeenCalledTimes(1);
  });

  it("vision nulle récupérée par la relecture ciblée : exploitable", () => {
    expect(visionUnusable({ ok: true, error: "", json: JSON.stringify({ read_provenance: { vision_initial: "failed", recheck_used: true } }) })).toBe(false);
    expect(visionUnusable({ ok: true, error: "", json: JSON.stringify({ read_provenance: { vision_initial: "failed", recheck_used: false } }) })).toBe(true);
    expect(visionUnusable(null)).toBe(true);
  });

  it("PDF texte : texte local d'abord, comme avant", async () => {
    ocr.mockResolvedValue({ ok: true, error: "", json: JSON.stringify(GOOD) });
    await readPurchaseDoc(new File(["%PDF"], "bl.pdf", { type: "application/pdf" }));
    expect(localDocText).toHaveBeenCalledTimes(1);
    expect((ocr.mock.calls[0]![0] as { data: { text?: string } }).data.text).toBe("texte ocr local");
  });

  it("envoi de l'original en parallèle : lecture non bloquée, fiche jamais créée si l'envoi échoue", async () => {
    let fail!: (e: Error) => void;
    const prepared = new Promise<never>((_, rej) => { fail = rej; });
    prepared.catch(() => undefined);
    ocr.mockResolvedValue({ ok: true, error: "", json: JSON.stringify(GOOD) });
    const r = await readPurchaseDoc(photo()); // l'envoi est encore en cours
    expect(r.extracted.supplier).toBe("FOURNISSEUR TEST");
    fail(new Error("Envoi impossible"));
    await expect(uploadSupplierDoc({ file: r.file, extracted: r.extracted, siteId: "s", prepared })).rejects.toThrow("Envoi impossible");
    expect(insert).not.toHaveBeenCalled();
  });

  it("document déjà déposé : fiche existante réutilisée, aucune insertion", async () => {
    const existing = { id: "d1" } as never;
    const doc = await uploadSupplierDoc({ file: photo(), extracted: {}, siteId: "s", prepared: Promise.resolve({ contentHash: "h", path: "p", reused: true, existing, uploadMs: 1 }) });
    expect(doc).toBe(existing);
    expect(insert).not.toHaveBeenCalled();
  });
});
