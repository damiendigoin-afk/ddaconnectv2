// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { addToDistricashCart, type CartFlowDeps } from "../districash-cart-flow";
import { CART_STORE_FIELDS } from "../districash-cart";
import { assertCartPath } from "../districash-session.server";
import { districashBrowserAddUrl, districashCartPrefillUrl } from "../tire-supplier-order";

const vals: Record<string, string> = Object.fromEntries(CART_STORE_FIELDS.map((f) => [f, `v_${f}`]));
Object.assign(vals, { code_article: "REFX1", prix_achat: "50.00" });
const form = `<form>${CART_STORE_FIELDS.filter((f) => f !== "quantite").map((f) => `<input name="${f}" value="${vals[f]}">`).join("")}</form>`;
const product = `<meta name="csrf-token" content="P"><span data-dispo-type="ag"></span>${form}`;
const cart = `<input id="command-reference-77"><input id="command-immatriculation-77">`;
const input = { productUrl: "https://districashv2.inoshop.net/catalog/product/REFX1/X/STD", code: "REFX1", quantity: 2, purchaseHt: 50, allowExistingInCart: false };
function deps(over: Partial<CartFlowDeps> = {}, cartHtml = cart, productHtml = product) {
  const post = vi.fn(async (..._a: unknown[]) => ({ status: 200, contentType: "application/json", text: JSON.stringify({ cart_content: { nb_added: 2, data_ref: "D1", price_total: "100" } }) }));
  // Après un POST, le panier relu contient l'article (comportement d'un vrai ajout dans la même session).
  const get = async (p: string) => ({ status: 200, text: p === "/cart" ? (post.mock.calls.length ? cartHtml + "REFX1" : cartHtml) : productHtml });
  return { post, d: { open: async () => ({ token: "T", blocker: null }), get, post, ...over } as CartFlowDeps };
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
  it("nb_added sans article dans le panier relu = incertain, jamais succès (bug prod 16/10)", async () => {
    const post = vi.fn(async (..._a: unknown[]) => ({ status: 200, contentType: "application/json", text: JSON.stringify({ cart_content: { nb_added: 2, data_ref: "D1" } }) }));
    const d = { open: async () => ({ token: "T", blocker: null }), get: async (p: string) => ({ status: 200, text: p === "/cart" ? cart : product }), post } as CartFlowDeps;
    expect((await addToDistricashCart(d, input)).status).toBe("uncertain");
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("chemins commande/paiement interdits", () => {
    for (const p of ["/cart/order", "/cart/payment", "/order/registered", "/rest/xat2v2"]) expect(() => assertCartPath(p, "POST")).toThrow();
    expect(() => assertCartPath("/cart/order", "GET")).toThrow();
    expect(() => assertCartPath("https://evil.com/cart/store", "POST")).toThrow();
    expect(assertCartPath("/cart/store", "POST")).toContain("/cart/store");
  });
});

type Req = { path: string; code: string; qty: number; pa: number; account: string; ref: string; immat: string };
type Http = { get: (p: string) => Promise<{ status: number; text: string }>; post: (p: string, b: URLSearchParams, c: string) => Promise<{ status: number; text: string }> };
type ExtApi = {
  ddaPrefill: (w: Window) => { filled: number };
  parseAddRequest: (h: URLSearchParams) => (Req & { error?: undefined }) | { error: string } | null;
  detectAccount: (html: string, expected: string) => "match" | "other" | "unknown";
  runAdd: (http: Http, req: Req, csrf: string) => Promise<{ status: string; message: string }>;
  assertPath: (p: string, m: string) => string;
};

describe("extension : ajout dans la session du navigateur (mocks)", () => {
  const mod: { exports: unknown } = { exports: null };
  new Function("module", readFileSync("extension/districash-prefill/prefill.js", "utf8"))(mod);
  const ext = mod.exports as ExtApi;
  const url = districashBrowserAddUrl({ orNumber: "78546", plate: "EE-111-EE", productUrl: "https://districashv2.inoshop.net/catalog/product/REFX1/4007/STD", code: "REFX1", quantity: 2, purchaseHt: 50, account: "60669" })!;
  const req = ext.parseAddRequest(new URLSearchParams(new URL(url).hash.slice(1))) as Req;
  function http(over: Partial<Http> = {}, afterHasCode = true) {
    const post = vi.fn(async () => ({ status: 200, text: JSON.stringify({ cart_content: { nb_added: 2 } }) }));
    const get = vi.fn(async (p: string) => ({ status: 200, text: p === "/cart" ? (post.mock.calls.length && afterHasCode ? cart + "REFX1" : cart) : product }));
    return { post, get, h: { get, post, ...over } as Http };
  }
  it("lien DDA : fiche, quantité, PA, compte, OR: 78546 et immat sans secret", () => {
    expect(req).toMatchObject({ path: "/catalog/product/REFX1/4007/STD", code: "REFX1", qty: 2, pa: 50, account: "60669", ref: "OR: 78546", immat: "EE111EE" });
    expect(url).not.toMatch(/token|cookie|password/i);
  });
  it("pas de lien si fiche non sûre", () => {
    expect(districashBrowserAddUrl({ orNumber: "1", plate: "", productUrl: "https://evil.com/catalog/product/X", code: "X1", quantity: 1, purchaseHt: 1, account: "60669" })).toBeNull();
  });
  it("refuse fiche hors portail / compte inconnu / quantité folle", () => {
    expect(ext.parseAddRequest(new URLSearchParams("dda-add=/cart/order&dda-code=REFX1&dda-qty=2&dda-pa=50&dda-account=60669"))).toHaveProperty("error");
    expect(ext.parseAddRequest(new URLSearchParams("dda-add=/catalog/product/A&dda-code=REFX1&dda-qty=2&dda-pa=50&dda-account=99999"))).toHaveProperty("error");
    expect(ext.parseAddRequest(new URLSearchParams("dda-add=/catalog/product/A&dda-code=REFX1&dda-qty=99&dda-pa=50&dda-account=60669"))).toHaveProperty("error");
  });
  it("succès seulement si l'article est retrouvé dans le panier relu, un seul POST", async () => {
    const { h, post } = http();
    expect((await ext.runAdd(h, req, "CSRF")).status).toBe("added");
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body, csrf] = post.mock.calls[0] as unknown as [string, URLSearchParams, string];
    expect(path).toBe("/cart/store");
    expect(csrf).toBe("CSRF");
    expect(body.get("quantite")).toBe("2");
    expect(body.get("_token")).toBe("CSRF");
  });
  it("nb_added mais panier relu vide = incertain", async () => {
    const { h } = http({}, false);
    expect((await ext.runAdd(h, req, "CSRF")).status).toBe("uncertain");
  });
  it("déjà au panier / prix changé / non J-J+ : aucun POST", async () => {
    const a = http({ get: async (p) => ({ status: 200, text: p === "/cart" ? cart + "REFX1" : product }) });
    expect((await ext.runAdd(a.h, req, "C")).status).toBe("already_in_cart");
    const b = http();
    expect((await ext.runAdd(b.h, { ...req, pa: 49 }, "C")).status).toBe("refused");
    const c = http({ get: async (p) => ({ status: 200, text: p === "/cart" ? cart : product.replace('"ag"', '"rouge"') }) });
    expect((await ext.runAdd(c.h, req, "C")).status).toBe("refused");
    for (const x of [a, b, c]) expect(x.post).not.toHaveBeenCalled();
  });
  it("compte détecté sur la page", () => {
    expect(ext.detectAccount("<div>Client 60669</div>", "60669")).toBe("match");
    expect(ext.detectAccount("<div>Client 19025</div>", "60669")).toBe("other");
    expect(ext.detectAccount("<div>Panier</div>", "60669")).toBe("unknown");
  });
  it("chemins commande/paiement interdits dans l'extension", () => {
    for (const p of ["/cart/order", "/cart/payment", "/order/registered", "/rest/xat2v2", "https://evil.com/cart/store"]) expect(() => ext.assertPath(p, "POST")).toThrow();
    expect(() => ext.assertPath("/cart/order", "GET")).toThrow();
  });
});

describe("extension de préremplissage", () => {
  const mod: { exports: unknown } = { exports: null };
  new Function("module", readFileSync("extension/districash-prefill/prefill.js", "utf8"))(mod);
  const ext = mod.exports as ExtApi;
  const ddaPrefill = ext.ddaPrefill;
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
