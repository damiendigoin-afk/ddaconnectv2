import { describe, expect, it, vi } from "vitest";
import { STORAGE_BUSY_MESSAGE, uploadWithRetry } from "@/lib/storage-retry";

type R = { data: unknown; error: unknown };
function bucket(results: R[], listed: string[] = []) {
  const upload = vi.fn(async () => results.shift() ?? { data: {}, error: null });
  const list = vi.fn(async () => ({ data: listed.map((name) => ({ name })), error: null }));
  return { upload, list };
}
const ok: R = { data: { path: "p" }, error: null };
const e = (statusCode: number | undefined, message: string): R => ({ data: null, error: { statusCode, message } });
const sleep = vi.fn(async () => undefined);
const run = (b: ReturnType<typeof bucket>) =>
  uploadWithRetry(b as never, "fournisseurs/x.pdf", "FILE", { upsert: false }, { sleep });

describe("uploadWithRetry", () => {
  it("succès au 1er essai => 1 upload", async () => {
    const b = bucket([ok]);
    await run(b);
    expect(b.upload).toHaveBeenCalledTimes(1);
  });
  it("429 puis succès => 2 appels, mêmes bucket/chemin/options", async () => {
    const b = bucket([e(429, "rate"), ok]);
    await run(b);
    expect(b.upload).toHaveBeenCalledTimes(2);
    expect(b.upload.mock.calls[1]).toEqual(["fournisseurs/x.pdf", "FILE", { upsert: false }]);
  });
  it("503 puis succès => retry", async () => {
    const b = bucket([e(503, "unavailable"), ok]);
    await run(b);
    expect(b.upload).toHaveBeenCalledTimes(2);
  });
  it("message Too many connections puis succès => retry", async () => {
    const b = bucket([e(undefined, "Too many connections issued to the database"), ok]);
    await run(b);
    expect(b.upload).toHaveBeenCalledTimes(2);
  });
  it("3 échecs transitoires => message utilisateur, délais 1 s puis 3 s", async () => {
    sleep.mockClear();
    const b = bucket([e(429, "x"), e(429, "x"), e(503, "x")]);
    await expect(run(b)).rejects.toThrow(STORAGE_BUSY_MESSAGE);
    expect(b.upload).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 3000]);
  });
  it("403 => aucun retry, erreur d'origine", async () => {
    const b = bucket([e(403, "forbidden")]);
    await expect(run(b)).rejects.toMatchObject({ statusCode: 403 });
    expect(b.upload).toHaveBeenCalledTimes(1);
  });
  it("already exists au retry et fichier présent => succès sans doublon", async () => {
    const b = bucket([e(503, "lost"), e(409, "The resource already exists")], ["x.pdf"]);
    await run(b);
    expect(b.upload).toHaveBeenCalledTimes(2);
    expect(b.list).toHaveBeenCalledWith("fournisseurs", expect.anything());
  });
  it("already exists sans erreur transitoire préalable => erreur (pas de faux succès)", async () => {
    const b = bucket([e(409, "already exists")], ["x.pdf"]);
    await expect(run(b)).rejects.toMatchObject({ statusCode: 409 });
  });
  it("échec final => aucune écriture métier après l'upload", async () => {
    const insert = vi.fn();
    const b = bucket([e(429, "x"), e(429, "x"), e(429, "x")]);
    await expect(run(b).then(insert)).rejects.toThrow(STORAGE_BUSY_MESSAGE);
    expect(insert).not.toHaveBeenCalled();
  });
});
