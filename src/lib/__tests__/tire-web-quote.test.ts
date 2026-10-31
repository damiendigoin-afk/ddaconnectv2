import { describe, expect, it } from "vitest";
import { WEB_QUOTE_CASES, WEB_SUPPLIERS, canActivateWeb, webConnectionState, webSupplierKey } from "../tire-web-quote";

describe("devis pneus site web", () => {
  it("6 cases fixes été/4 saisons × entrée/milieu/haut", () => {
    expect(WEB_QUOTE_CASES).toHaveLength(6);
    expect(new Set(WEB_QUOTE_CASES.map((c) => `${c.season}:${c.tier}`)).size).toBe(6);
  });
  it("aucune sélection implicite de fournisseur", () => {
    expect(webSupplierKey(null)).toBeNull();
    expect(webSupplierKey("inconnu")).toBeNull();
    expect(WEB_SUPPLIERS.map((s) => s.key).sort()).toEqual(["catalogue_local", "centralepneus", "districash"]);
  });
  it("jamais connecté sans contrôle réel", () => {
    expect(webConnectionState({ supplier: "centralepneus", siteId: "s", centrale: null }).state).toBe("jamais_controle");
    expect(webConnectionState({ supplier: "districash", siteId: "s", districash: { configured: true, lastTestOk: null, lastTestAt: null } }).state).toBe("jamais_controle");
    expect(webConnectionState({ supplier: "districash", siteId: "s", districash: { configured: false, lastTestOk: true, lastTestAt: "2026-10-01" } }).state).toBe("identifiants_absents");
    expect(webConnectionState({ supplier: "districash", siteId: null }).state).toBe("site_requis");
  });
  it("activation bloquée sans point d'entrée public", () => {
    expect(canActivateWeb().ok).toBe(false);
  });
});
