// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { addToDistricashCart, type CartFlowDeps } from "../districash-cart-flow";
import { CART_STORE_FIELDS } from "../districash-cart";
import { assertCartPath } from "../districash-session.server";
import { districashCartPrefillUrl } from "../tire-supplier-order";

const vals: Record<string, string> = Object.fromEntries(CART_STORE_FIELDS.map((f) => [f, `v_${f}`]));
Object.assign(vals, { code_article: "REFX1", prix_achat: "50.00" });
const form = `<form>${CART_STORE_FIELDS.filter((f) => f !== "quantite").map((f) => `<input name="${f}" value="${vals[f]}">`).join("")}</form>`;
const product = `<meta name="csrf-token" content="P"><span data-dispo-type="ag"></span>${form}`;
const cart = `<input id="command-reference-77"><input id="command-immatriculation-77">`;
const input = { productUrl: "https://districashv2.inoshop.net/catalog/product/REFX1/X/STD", code: "REFX1", quantity: 2, purchaseHt: 50, allowExistingInCart: false };
function deps(over: Partial<CartFlowDeps> = {}, cartHtml = cart, productHtml = product) {
  const post = vi.fn(async () => ({ status: 200, contentType: "application/json", text: JSON.stringify({ cart_content: { nb_added: 2, data_ref: "D1", price_total: "100" } }) }));
  return { post, d: { open: async () => ({ token: "T", blocker: null }), get: async (p: string) => ({ status: 200, text: p === "/cart" ? cartHtml : productHtml }), post, ...over } as CartFlowDeps };
}

describe("ajout panier Districash (mocks)", () => {
  it("ajoute avec les valeurs du formulaire réel et la quantité commandée", async () => {
    const { d, post } = deps();
    const r = await addToDistricashCart(d, input);
    expect(r).toMatchObject({ status: "added", cartId: "77", dataRef: "D1" });
    const body = post.mock.calls[0]![1] as URLSearchParams;
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
    const post = vi.fn(async () => { throw new Error("abort"); });
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

describe("extension de préremplissage", () => {
  const ddaPrefill = createRequire(import.meta.url)("../../../extension/districash-prefill/prefill.js");
  it("remplit les deux champs depuis le lien DDA", () => {
    document.body.innerHTML = cart;
    window.location.hash = new URL(districashCartPrefillUrl({ orNumber: "17264", plate: "ab-123-cd" })).hash;
    expect(ddaPrefill(window).filled).toBe(2);
    expect((document.getElementById("command-reference-77") as HTMLInputElement).value).toBe("OR: 17264");
    expect((document.getElementById("command-immatriculation-77") as HTMLInputElement).value).toBe("AB123CD");
  });
  it("n'écrase pas une saisie existante", () => {
    document.body.innerHTML = `<input id="command-reference-9" value="AUTRE">`;
    window.location.hash = "dda-ref=OR%3A%201";
    expect(ddaPrefill(window).filled).toBe(0);
  });
});
