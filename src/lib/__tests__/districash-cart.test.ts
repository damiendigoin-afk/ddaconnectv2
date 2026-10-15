import { describe, expect, it } from "vitest";
import { buildCartStorePayload, CART_STORE_FIELDS, parseCartStoreResponse } from "../districash-cart";

const vals: Record<string, string> = Object.fromEntries(CART_STORE_FIELDS.map((f) => [f, `v_${f}`]));
Object.assign(vals, { code_article: "REFX1", code_ean: "1111111111111", prix_achat: "50.00" });
const row = CART_STORE_FIELDS.filter((f) => f !== "quantite").map((f) => `<input type="hidden" name="${f}" value="${vals[f]}">`).join("");
const check = { code: "REFX1", ean: "1111111111111", quantity: 2, purchaseHt: 50, availability: "J" };

describe("ajout panier Districash (mock, désactivé)", () => {
  it("construit le corps uniquement depuis la ligne + quantité du devis", () => {
    const r = buildCartStorePayload(row, "tok", check);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.body.get("quantite")).toBe("2"); expect(r.body.get("scenario")).toBe("v_scenario"); }
  });
  it("refuse si un champ manque", () => {
    expect(buildCartStorePayload(row.replace(/name="scenario"/, 'name="zz"'), "tok", check).ok).toBe(false);
  });
  it("refuse si référence, EAN ou prix diffèrent", () => {
    expect(buildCartStorePayload(row, "tok", { ...check, code: "AUTRE" }).ok).toBe(false);
    expect(buildCartStorePayload(row, "tok", { ...check, ean: "2222222222222" }).ok).toBe(false);
    expect(buildCartStorePayload(row, "tok", { ...check, purchaseHt: 51 }).ok).toBe(false);
  });
  it("refuse indisponible, quantité invalide, sans jeton", () => {
    expect(buildCartStorePayload(row, "tok", { ...check, availability: "indisponible" }).ok).toBe(false);
    expect(buildCartStorePayload(row, "tok", { ...check, quantity: 0 }).ok).toBe(false);
    expect(buildCartStorePayload(row, "", check).ok).toBe(false);
  });
  it("succès seulement si nb_added > 0, sinon inconnu sans renvoi", () => {
    expect(parseCartStoreResponse({ cart_content: { nb_added: 2, price_total: "81.84" } }).status).toBe("added");
    expect(parseCartStoreResponse({ cart_content: { nb_added: 0 } }).status).toBe("unknown");
    expect(parseCartStoreResponse({ error_message: "Stock" }).status).toBe("refused");
    expect(parseCartStoreResponse(null).status).toBe("unknown");
  });
});
