import { describe, expect, it } from "vitest";

import {
  LOCAL_STATE_VERSION,
  VERSION_KEY,
  RECOVERY_FLAG,
  collectIncompatibleKeys,
  isStaleAssetError,
  isValidSiteValue,
  migrateLocalState,
  shouldAutoRecover,
  describeClientError,
} from "@/lib/client-recovery";

class FakeStore {
  private map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  snapshot() {
    return Object.fromEntries(this.map);
  }
}

describe("démarrage d'un tour avec état local ancien (Pixel 7)", () => {
  it("supprime les clés héritées, le site fantôme et le JSON illisible", () => {
    const store = new FakeStore({
      "dda.active-site": "site-lalinde", // ancien format, plus un UUID
      "dda.tour-draft.abc": '{"zone":3}', // clé d'une version précédente
      "dda.packages-import.job": "{cassé", // JSON illisible
      "autre.app": "garder",
    });

    const { removed } = migrateLocalState(store);

    expect(removed.sort()).toEqual(
      ["dda.active-site", "dda.packages-import.job", "dda.tour-draft.abc"].sort(),
    );
    // Les données étrangères au client DDA ne sont pas touchées.
    expect(store.getItem("autre.app")).toBe("garder");
    expect(store.getItem(VERSION_KEY)).toBe(String(LOCAL_STATE_VERSION));
    // Deuxième démarrage : plus rien à nettoyer, le parcours démarre normalement.
    expect(collectIncompatibleKeys(store)).toEqual([]);
  });

  it("conserve un état local valide et à jour", () => {
    const store = new FakeStore({
      "dda.active-site": "8f2f0e3e-5f31-4f0f-9e0a-1c2d3e4f5a6b",
      [VERSION_KEY]: String(LOCAL_STATE_VERSION),
    });
    expect(collectIncompatibleKeys(store)).toEqual([]);
    migrateLocalState(store);
    expect(store.getItem("dda.active-site")).toBe("8f2f0e3e-5f31-4f0f-9e0a-1c2d3e4f5a6b");
  });

  it("accepte le contexte groupe et refuse une valeur vide", () => {
    expect(isValidSiteValue("groupe")).toBe(true);
    expect(isValidSiteValue("")).toBe(false);
    expect(isValidSiteValue("DDA")).toBe(false);
  });

  it("reconnaît un bundle mobile périmé et le journalise", () => {
    const err = new TypeError("Failed to fetch dynamically imported module: /assets/tour-abc.js");
    expect(isStaleAssetError(err)).toBe(true);
    expect(isStaleAssetError(new Error("boom"))).toBe(false);
    const described = describeClientError(err, { route: "/tour/42" });
    expect(described.staleAsset).toBe(true);
    expect((described as { route?: string }).route).toBe("/tour/42");
  });

  it("ne relance la récupération automatique qu'une fois par session", () => {
    const session = new FakeStore();
    expect(shouldAutoRecover(session)).toBe(true);
    expect(session.getItem(RECOVERY_FLAG)).toBeTruthy();
    expect(shouldAutoRecover(session)).toBe(false);
  });
});
