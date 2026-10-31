import { describe, expect, it } from "vitest";
import { WEB_QUOTE_CASES, WEB_SUPPLIERS, webConnectionState, webSupplierKey } from "../tire-web-quote";

describe("devis pneus site web", () => {
  it("6 cases fixes été/4 saisons × entrée/milieu/haut", () => {
    expect(WEB_QUOTE_CASES).toHaveLength(6);
    expect(new Set(WEB_QUOTE_CASES.map((c) => `${c.season}:${c.tier}`)).size).toBe(6);
  });
  it("web exclusivement Top prix, aucune sélection implicite", () => {
    expect(webSupplierKey(null)).toBeNull();
    expect(webSupplierKey("districash")).toBeNull();
    expect(WEB_SUPPLIERS.map((s) => s.key)).toEqual(["top_prix"]);
    expect(webConnectionState({ supplier: "top_prix", siteId: null }).state).toBe("site_requis");
    expect(webConnectionState({ supplier: "top_prix", siteId: "s", districash: { configured: false, lastTestOk: null, lastTestAt: null } }).state).toBe("identifiants_absents");
  });
  it("jamais connecté sans contrôle réel", () => {
    expect(webConnectionState({ supplier: "centralepneus", siteId: "s", centrale: null }).state).toBe("jamais_controle");
    expect(webConnectionState({ supplier: "districash", siteId: "s", districash: { configured: true, lastTestOk: null, lastTestAt: null } }).state).toBe("jamais_controle");
    expect(webConnectionState({ supplier: "districash", siteId: "s", districash: { configured: false, lastTestOk: true, lastTestAt: "2026-10-01" } }).state).toBe("identifiants_absents");
    expect(webConnectionState({ supplier: "districash", siteId: null }).state).toBe("site_requis");
  });
  it("erreur de lecture Districash distincte", () => {
    expect(webConnectionState({ supplier: "districash", siteId: "s", districashError: true }).state).toBe("lecture_impossible");
  });
});
