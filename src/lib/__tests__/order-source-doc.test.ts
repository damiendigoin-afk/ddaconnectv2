import { describe, expect, it, vi } from "vitest";
import { canDeleteStorageObject, metadataHasNoContent, orderLinkPatch, orderSourceDoc, SIGNED_URL_TTL } from "@/lib/order-docs-rules";

const signed = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => signed(...a) }) } },
}));

const doc = { id: "d1", storage_path: "fournisseurs/0b7a.pdf", file_name: "commande-2887082.pdf", mime_type: "application/pdf", file_size: 48213, created_at: "2026-09-29T12:25:00Z" };

describe("document source d'une commande", () => {
  it("rattachement : commande avec document => métadonnées exploitables", () => {
    expect(orderSourceDoc({ source_document_id: "d1", inbox_documents: doc })).toEqual({ id: "d1", storagePath: doc.storage_path, fileName: doc.file_name, mimeType: "application/pdf", size: 48213, createdAt: doc.created_at });
  });
  it("pas de document => pas de bouton", () => {
    expect(orderSourceDoc({ source_document_id: null, inbox_documents: null })).toBeNull();
    expect(orderSourceDoc({ source_document_id: "d1", inbox_documents: { ...doc, storage_path: null } })).toBeNull();
  });
  it("jamais de base64 / data URL comme chemin ni en métadonnées", () => {
    expect(orderSourceDoc({ source_document_id: "d1", inbox_documents: { ...doc, storage_path: "data:application/pdf;base64,JVBERi0x" } })).toBeNull();
    expect(metadataHasNoContent(doc)).toBe(true);
    expect(metadataHasNoContent({ ...doc, extra: "data:application/pdf;base64,JVBERi0xLjQ=" })).toBe(false);
  });
  it("rattachement du document à la commande sans écraser un autre lien", () => {
    expect(orderLinkPatch({ linked_kind: null, linked_id: null }, "o1")).toEqual({ linked_kind: "part_order", linked_id: "o1" });
    expect(orderLinkPatch({ linked_kind: "part_receipt", linked_id: "r1" }, "o1")).toBeNull();
  });
  it("fichier encore référencé jamais supprimé", () => {
    expect(canDeleteStorageObject(doc.storage_path, ["d2"])).toBe(false);
    expect(canDeleteStorageObject(doc.storage_path, [])).toBe(true);
  });
});

describe("URL signée courte, refusée sans droit", () => {
  it("autorisé : URL courte (5 min) générée à la demande", async () => {
    const { orderDocSignedUrl } = await import("@/lib/order-docs");
    signed.mockResolvedValueOnce({ data: { signedUrl: "https://x/sign?token=t" }, error: null });
    expect(await orderDocSignedUrl(doc.storage_path)).toBe("https://x/sign?token=t");
    expect(signed).toHaveBeenLastCalledWith(doc.storage_path, SIGNED_URL_TTL, undefined);
    expect(SIGNED_URL_TTL).toBeLessThanOrEqual(600);
  });
  it("refusé par le stockage (autre site) => null", async () => {
    const { orderDocSignedUrl } = await import("@/lib/order-docs");
    signed.mockResolvedValueOnce({ data: null, error: { message: "Object not found" } });
    expect(await orderDocSignedUrl(doc.storage_path)).toBeNull();
  });
  it("chemin hors stockage fournisseur => aucun appel", async () => {
    const { orderDocSignedUrl } = await import("@/lib/order-docs");
    signed.mockClear();
    expect(await orderDocSignedUrl("../notes-frais/x.pdf")).toBeNull();
    expect(signed).not.toHaveBeenCalled();
  });
});
