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

describe("champs présents mais vides (formulaire réel)", () => {
  const real: Record<string, string> = {
    mode_modal: "0", origin: "catalog", id: "REFY", gencode: "123", c_fourn_cata: "321", c_fourn: "", code_article: "REFY",
    code_article_fournisseur: "REFY", code_marque: "M", platform_img: "https://x/i.png", platform_libdispo: "Disponible plateforme",
    platform_libdispobtn: "Disponible groupe", prix_achat: "40.92", prix_vente: "123.40", devise: "", consigne: "0", code_fam: "01",
    code_sfam: "TE", code_ean: "123", code_supplier: "", libelle_article: "PN X", identifiant_administratif: " ", type_erp: "STD", code_agence: "AG", scenario: "0",
  };
  const html = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join("");
  const c = { code: "REFY", ean: null, quantity: 2, purchaseHt: 40.92, availability: "J+" };
  it("accepte devise/c_fourn/code_supplier vides et les envoie littéralement", () => {
    const r = buildCartStorePayload(html(real), "tok", c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.get("devise")).toBe("");
    expect(r.body.get("c_fourn")).toBe("");
    expect(r.body.get("code_supplier")).toBe("");
    expect(r.body.get("identifiant_administratif")).toBe(" ");
    expect(r.body.toString()).toContain("devise=&");
  });
  it("champ absent du formulaire = refus", () => {
    const { devise: _d, ...rest } = real;
    expect(buildCartStorePayload(html(rest), "tok", c)).toMatchObject({ ok: false, reason: "Champ portail introuvable : devise." });
  });
  it("champ critique vide = refus", () => {
    expect(buildCartStorePayload(html({ ...real, code_agence: "" }), "tok", c).ok).toBe(false);
    expect(buildCartStorePayload(html({ ...real, prix_achat: "" }), "tok", c).ok).toBe(false);
  });
  it("prix, référence et dispo toujours vérifiés", () => {
    expect(buildCartStorePayload(html({ ...real, prix_achat: "41.50" }), "tok", c).ok).toBe(false);
    expect(buildCartStorePayload(html({ ...real, code_article: "AUTRE" }), "tok", c).ok).toBe(false);
    expect(buildCartStorePayload(html(real), "tok", { ...c, availability: "indisponible" }).ok).toBe(false);
  });
  it("apostrophes et input sans value", () => {
    expect(buildCartStorePayload(html(real).replace('name="devise" value=""', "name='devise'"), "tok", c).ok).toBe(true);
  });
});
