// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockText, copyText } from "../copy-text.browser";

afterEach(() => vi.restoreAllMocks());

describe("copie presse-papiers", () => {
  it("utilise navigator.clipboard quand disponible", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });
  it("repli textarea si l'API échoue ; échec signalé", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("x")) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText("abc")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    exec.mockReturnValue(false);
    expect(await copyText("abc")).toBe(false);
  });
  it("texte du bloc : lignes conservées, boutons exclus", () => {
    const el = document.createElement("div");
    el.innerHTML = `<div>ok — 3 résultats</div><div>I. Lignes <span>x</span></div><button data-nocopy>Copier</button>`;
    expect(blockText(el)).toBe("ok — 3 résultats\nI. Lignes x");
  });
});
