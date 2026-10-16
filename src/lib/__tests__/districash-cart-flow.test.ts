// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { addToDistricashCart, type CartFlowDeps } from "../districash-cart-flow";
import { CART_STORE_FIELDS } from "../districash-cart";
import { assertCartPath } from "../districash-session.server";
import { checkCartSiteBinding, districashCartLabel, districashCartPrefillUrl } from "../tire-supplier-order";

const vals: Record<string, string> = Object.fromEntries(CART_STORE_FIELDS.map((f) => [f, `v_${f}`]));
Object.assign(vals, { code_article: "REFX1", prix_achat: "50.00" });
const form = `<form>${CART_STORE_FIELDS.filter((f) => f !== "quantite").map((f) => `<input name="${f}" value="${vals[f]}">`).join("")}</form>`;
const product = `<meta name="csrf-token" content="P"><span data-dispo-type="ag"></span>${form}`;
const cart = `<input id="command-reference-77"><input id="command-immatriculation-77">`;
const input = { productUrl: "https://districashv2.inoshop.net/catalog/product/REFX1/X/STD", code: "REFX1", quantity: 2, purchaseHt: 50, allowExistingInCart: false };
function deps(over: Partial<CartFlowDeps> = {}, cartHtml = cart, productHtml = product) {
  const post = vi.fn(async (..._a: unknown[]) => ({ status: 200, contentType: "application/json", text: JSON.stringify({ cart_content: { nb_added: 2, data_ref: "D1", price_total: "100" } }) }));
  return { post, d: { open: async () => ({ token: "T", blocker: null }), get: async (p: string) => ({ status: 200, text: p === "/cart" ? cartHtml : productHtml }), post, ...over } as CartFlowDeps };
}

describe("ajout panier Districash (mocks)", () => {
  it("ajoute avec les valeurs du formulaire réel et la quantité commandée", async () => {
    const { d, post } = deps();
    const r = await addToDistricashCart(d, input);
    expect(r).toMatchObject({ status: "added", cartId: "77", dataRef: "D1" });
    const body = (post.mock.calls[0] as unknown[])[1] as URLSearchParams;
    expect(body.get("quantite")).toBe("2");
    expect(body.get("_token")).toBe("P");
  });
  it("refuse si prix changé, sans envoyer", async () => {
    const { d, post } = deps();
    expect((await addToDistricashCart(d, { ...input, purchaseHt: 49 })).status).toBe("refused");
    expect(post).not.toHaveBeenCalled();
  });
  it("refuse si disponibilité non J/J+", async () => {
    const { d, post } = deps({}, cart, product.replace('"ag"', '"rouge"'));
    expect((await addToDistricashCart(d, input)).status).toBe("refused");
    expect(post).not.toHaveBeenCalled();
  });
  it("signale une référence déjà au panier", async () => {
    const { d, post } = deps({}, cart + "REFX1");
    expect((await addToDistricashCart(d, input)).status).toBe("already_in_cart");
    expect(post).not.toHaveBeenCalled();
  });
  it("timeout = incertain, un seul envoi", async () => {
    const post = vi.fn(async (..._a: unknown[]) => { throw new Error("abort"); });
    const { d } = deps({ post });
    expect((await addToDistricashCart(d, input)).status).toBe("uncertain");
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("réponse sans nb_added = incertain, jamais succès", async () => {
    const { d } = deps({ post: async () => ({ status: 200, contentType: "application/json", text: "{}" }) });
    expect((await addToDistricashCart(d, input)).status).toBe("uncertain");
  });
  it("chemins commande/paiement interdits", () => {
    for (const p of ["/cart/order", "/cart/payment", "/order/registered", "/rest/xat2v2"]) expect(() => assertCartPath(p, "POST")).toThrow();
    expect(() => assertCartPath("/cart/order", "GET")).toThrow();
    expect(() => assertCartPath("https://evil.com/cart/store", "POST")).toThrow();
    expect(assertCartPath("/cart/store", "POST")).toContain("/cart/store");
  });
});

const LAL = "11111111-1111-1111-1111-111111111111", CAS = "22222222-2222-2222-2222-222222222222";
describe("panier du garage de la commande (multi-site)", () => {
  it("mapping : Lalinde → 60669, Castillon → 19025", () => {
    expect(districashCartLabel("dda")).toBe("Lalinde (60669)");
    expect(districashCartLabel("castillon")).toBe("Castillon (19025)");
    expect(districashCartLabel("autre")).toBeNull();
  });
  it("commande Lalinde : panier 60669 (celui qui a été rempli), jamais 19025", () => {
    const r = checkCartSiteBinding({ orderSiteId: LAL, orderSiteCode: "dda", requestedSiteId: LAL, userCanAccess: true, orderAccount: "60669" });
    expect(r).toEqual({ ok: true, account: "60669", label: "Lalinde (60669)" });
  });
  it("commande Castillon : panier 19025", () => {
    expect(checkCartSiteBinding({ orderSiteId: CAS, orderSiteCode: "castillon", requestedSiteId: CAS, userCanAccess: true, orderAccount: "19025" })).toMatchObject({ ok: true, account: "19025" });
  });
  it("site actif différent de la commande : bloqué, aucune bascule", () => {
    const r = checkCartSiteBinding({ orderSiteId: LAL, orderSiteCode: "dda", requestedSiteId: CAS, userCanAccess: true, orderAccount: "60669" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("Lalinde (60669)");
  });
  it("utilisateur non autorisé sur le garage : bloqué", () => {
    expect(checkCartSiteBinding({ orderSiteId: LAL, orderSiteCode: "dda", requestedSiteId: LAL, userCanAccess: false, orderAccount: "60669" }).ok).toBe(false);
  });
  it("compte enregistré incohérent (commande Lalinde marquée 19025) : bloqué", () => {
    expect(checkCartSiteBinding({ orderSiteId: LAL, orderSiteCode: "dda", requestedSiteId: LAL, userCanAccess: true, orderAccount: "19025" }).ok).toBe(false);
  });
});

describe("extension de préremplissage", () => {
  const mod: { exports: { readHash: (h: string) => { ref: string; immat: string } | null; ddaPrefill: (w: Window, v: unknown, t?: number) => Promise<{ filled: number }> } } = { exports: null as never };
  new Function("module", readFileSync("extension/districash-prefill/prefill.js", "utf8"))(mod);
  const { readHash, ddaPrefill } = mod.exports;
  it("décode le lien DDA ('+' = espace, %3A)", () => {
    expect(readHash("#dda-ref=OR%3A+78546&dda-immat=EE111EE")).toEqual({ ref: "OR: 78546", immat: "EE111EE" });
    expect(readHash(new URL(districashCartPrefillUrl({ orNumber: "78546", plate: "EE-111-EE" })).hash)).toEqual({ ref: "OR: 78546", immat: "EE111EE" });
    expect(readHash("#autre=1")).toBeNull();
  });
  it("remplit les deux champs présents", async () => {
    document.body.innerHTML = cart;
    expect((await ddaPrefill(window, { ref: "OR: 17264", immat: "AB123CD" }, 0)).filled).toBe(2);
    expect((document.getElementById("command-reference-77") as HTMLInputElement).value).toBe("OR: 17264");
    expect((document.getElementById("command-immatriculation-77") as HTMLInputElement).value).toBe("AB123CD");
  });
  it("remplit un panier rendu tardivement (ajax)", async () => {
    document.body.innerHTML = "";
    const p = ddaPrefill(window, { ref: "OR: 78546", immat: "" }, 50);
    document.body.innerHTML = `<div><input id="command-reference-8747596" value=""></div>`;
    expect((await p).filled).toBe(1);
    expect((document.getElementById("command-reference-8747596") as HTMLInputElement).value).toBe("OR: 78546");
  });
  it("n'écrase pas une saisie existante", async () => {
    document.body.innerHTML = `<input id="command-reference-9" value="AUTRE">`;
    expect((await ddaPrefill(window, { ref: "OR: 1", immat: "" }, 0)).filled).toBe(0);
  });
});
