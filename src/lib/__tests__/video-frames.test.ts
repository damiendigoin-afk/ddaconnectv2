import { describe, expect, it } from "vitest";
import { candidateTimes, isVideoFile, selectFrames, signature } from "../video-frames";

const flat = (l: number) => signature(new Array(16 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : l)), 4, 4);

describe("extraction vidéo État pneus", () => {
  it("garde 10 images réparties sur une vidéo de 4 s", () => {
    const t = candidateTimes(4);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(4);
    const items = t.map((_, i) => ({ sig: flat(30 + i * 10), value: i }));
    expect(selectFrames(items, 10)).toHaveLength(10);
  });
  it("écarte les frames noires et identiques", () => {
    const items = [{ sig: flat(0), value: "noire" }, { sig: flat(100), value: "a" }, { sig: flat(101), value: "dup" }, { sig: flat(160), value: "b" }];
    expect(selectFrames(items, 10)).toEqual(["a", "b"]);
  });
  it("accepte mp4, quicktime, webm et un type vide avec extension", () => {
    expect(isVideoFile({ type: "video/mp4", name: "a" })).toBe(true);
    expect(isVideoFile({ type: "video/quicktime", name: "a" })).toBe(true);
    expect(isVideoFile({ type: "", name: "IMG_1.MOV" })).toBe(true);
    expect(isVideoFile({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
  });
});
