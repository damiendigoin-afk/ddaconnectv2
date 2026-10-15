import { describe, expect, it } from "vitest";
import { districashSearchBody } from "../districash-session.server";

describe("districashSearchBody", () => {
  it("reproduit le formulaire urlencoded observé dans Chrome", () => {
    const b = districashSearchBody("tok", { width: "245", height: "45", diameter: "20" }, 2);
    expect(b.get("_token")).toBe("tok");
    expect(b.get("reference_input")).toBe("[]");
    expect(JSON.parse(b.get("tyre_inputs")!)).toEqual({ pneu_larg: "245", pneu_haut: "45", pneu_diam: "20", pneu_indc: "", pneu_indv: "" });
    expect(b.get("quantite")).toBe("2");
    expect(JSON.parse(b.get("user_filters")!)).toEqual({ search_type: "recherche_standard" });
    expect(b.get("searchTypeDefaut")).toBe("recherche_standard");
    expect(b.get("searchTypageCde")).toBe("");
  });
});

import { summarizeDistricashTest } from "../districash-session.server";
describe("summarizeDistricashTest", () => {
  const login = [{ step: "GET /", status: 200, note: "page connectée" }];
  it("authentification OK mais recherche en échec : message précis avec HTTP", () => {
    const r = summarizeDistricashTest({ authenticated: false, blocker: "x", rows: [], steps: [...login, { step: "POST /search", status: 500, note: "" }] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Authentification confirmée");
    expect(r.message).toContain("HTTP 500");
  });
  it("un 302 sans page connectée n'est jamais un succès", () => {
    const r = summarizeDistricashTest({ authenticated: false, blocker: "Session non ouverte", rows: [], steps: [{ step: "GET /", status: 302, note: "toujours déconnecté" }] });
    expect(r.ok).toBe(false);
  });
});
