import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadPhoto = vi.fn();
const uploadPhotoOriginal = vi.fn();
const compressImage = vi.fn();

vi.mock("@/lib/photo", () => ({
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  uploadPhotoOriginal: (...a: unknown[]) => uploadPhotoOriginal(...a),
  compressImage: (...a: unknown[]) => compressImage(...a),
}));

const { prepareCapture, uploadCapture } = await import("../photo-capture");

/** Retour caméra Chrome Android (Pixel 7) aux métadonnées partielles. */
function androidPhoto(opts: { size: number; type?: string; name?: string }) {
  return {
    size: opts.size,
    type: opts.type ?? "",
    name: opts.name,
    slice: () => ({}),
  } as unknown as File;
}

describe("flux photo partagé — compteur et voyants", () => {
  beforeEach(() => {
    uploadPhoto.mockReset();
    uploadPhotoOriginal.mockReset();
    compressImage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("normalise un fichier voyant sans nom ni type MIME", () => {
    const capture = prepareCapture(androidPhoto({ size: 3 * 1024 * 1024 }));
    expect(capture!.type).toBe("image/jpeg");
    expect(capture!.name).toMatch(/^compteur-\d+\.jpg$/);
  });

  it("refuse proprement un retour caméra annulé (voyant)", async () => {
    const res = await uploadCapture(null, "inspections/1", { inspection_id: "1" });
    expect(res.ok).toBe(false);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("envoie une photo compteur volumineuse après réduction", async () => {
    compressImage.mockResolvedValue({ size: 10 } as Blob);
    uploadPhoto.mockResolvedValue({ id: "m1", storage_path: "p.jpg" });
    const res = await uploadCapture(androidPhoto({ size: 52 * 1024 * 1024 }), "inspections/1", {
      inspection_id: "1",
    });
    expect(res.ok).toBe(true);
    expect(compressImage).toHaveBeenCalled();
  });

  it("bascule sur l'envoi original si la compression/envoi échoue, sans jeter", async () => {
    compressImage.mockRejectedValue(new Error("decode"));
    uploadPhoto.mockRejectedValue(new Error("network"));
    uploadPhotoOriginal.mockResolvedValue({ id: "m2", storage_path: "p2.jpg" });
    const res = await uploadCapture(androidPhoto({ size: 60 * 1024 * 1024 }), "inspections/1", {
      inspection_id: "1",
    });
    expect(res.ok).toBe(true);
  });

  it("retourne une erreur locale exploitable si tout échoue", async () => {
    uploadPhoto.mockRejectedValue(new Error("network"));
    uploadPhotoOriginal.mockRejectedValue(new Error("network"));
    const res = await uploadCapture(androidPhoto({ size: 1024, type: "image/webp" }), "inspections/1", {
      inspection_id: "1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Réessayez/);
  });
});
