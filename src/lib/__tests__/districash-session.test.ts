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
