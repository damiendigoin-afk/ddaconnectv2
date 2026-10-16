/**
 * Orchestration « Ajouter au panier Districash » (aucune commande).
 * Dépendances réseau injectées → testable par mocks uniquement.
 * Étapes : session → fiche produit (formulaire réel) → panier existant → POST /cart/store (une fois, sans réessai).
 */
import { buildCartStorePayload, parseCartStoreResponse } from "./districash-cart";

export type CartFlowDeps = {
  open: () => Promise<{ token: string | null; blocker: string | null }>;
  get: (path: string) => Promise<{ status: number; text: string }>;
  post: (path: string, body: URLSearchParams, csrf: string) => Promise<{ status: number; contentType: string; text: string }>;
};

export type CartFlowInput = { productUrl: string; code: string; quantity: number; purchaseHt: number; allowExistingInCart: boolean };

export type CartFlowResult =
  | { status: "added"; message: string; cartId: string | null; dataRef: string | null; total: string | null }
  | { status: "already_in_cart"; message: string; cartId: string | null }
  | { status: "refused"; message: string }
  | { status: "uncertain"; message: string };

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** Isole le <form> contenant code_article (sinon toute la page). */
export function productCartForm(html: string): string {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  return forms.find((f) => /name\s*=\s*"code_article"/i.test(f)) ?? html;
}

/** Disponibilité prouvée sur la fiche : code portail ag (J) ou grp (J+). */
export function productAvailability(html: string): "J" | "J+" | null {
  const m = /data-dispo-type\s*=\s*"\s*(ag|grp)\s*"/i.exec(html);
  return m ? (m[1]!.toLowerCase() === "ag" ? "J" : "J+") : null;
}

export function cartIdOf(html: string): string | null {
  return /id\s*=\s*"command-reference-([A-Za-z0-9_-]+)"/.exec(html)?.[1] ?? null;
}

export async function addToDistricashCart(deps: CartFlowDeps, i: CartFlowInput): Promise<CartFlowResult> {
  const s = await deps.open();
  if (s.blocker || !s.token) return { status: "refused", message: `Connexion Districash impossible : ${s.blocker ?? "session non ouverte"}.` };

  const prod = await deps.get(i.productUrl);
  if (prod.status !== 200) return { status: "refused", message: `Fiche produit inaccessible (HTTP ${prod.status}).` };
  const availability = productAvailability(prod.text);
  if (!availability) return { status: "refused", message: "Disponibilité J/J+ non confirmée sur la fiche : ajout annulé." };
  const csrf = /<meta\s+name="csrf-token"\s+content="([^"]+)"/.exec(prod.text)?.[1] ?? s.token;
  const built = buildCartStorePayload(productCartForm(prod.text), csrf, { code: i.code, ean: null, quantity: i.quantity, purchaseHt: i.purchaseHt, availability });
  if (!built.ok) return { status: "refused", message: built.reason };

  const cart = await deps.get("/cart");
  if (cart.status !== 200) return { status: "refused", message: `Panier illisible (HTTP ${cart.status}) : ajout annulé.` };
  const cartId = cartIdOf(cart.text);
  if (!i.allowExistingInCart && norm(cart.text).includes(norm(i.code)))
    return { status: "already_in_cart", message: "Cette référence est déjà dans le panier Districash (panier peut-être partagé).", cartId };

  let res;
  try {
    res = await deps.post("/cart/store", built.body, csrf);
  } catch {
    return { status: "uncertain", message: "Pas de réponse de Districash : l'article a peut-être été ajouté. Vérifiez le panier, sans relancer." };
  }
  if (res.status === 419 || res.status === 401) return { status: "refused", message: "Session refusée par Districash : rien n'a été ajouté." };
  if (!/json/i.test(res.contentType)) return { status: "uncertain", message: `Réponse inattendue (HTTP ${res.status}) : vérifiez le panier, sans relancer.` };
  let json: unknown = null;
  try { json = JSON.parse(res.text); } catch { /* illisible */ }
  const p = parseCartStoreResponse(json);
  if (p.status === "added") {
    // nb_added ne suffit pas : relecture immédiate du panier dans la MÊME session.
    const after = await deps.get("/cart").catch(() => null);
    if (!after || after.status !== 200 || !norm(after.text).includes(norm(i.code)))
      return { status: "uncertain", message: "Districash a répondu « ajouté » mais l'article est absent du panier relu : ajout non prouvé." };
    const dataRef = (json as { cart_content?: { data_ref?: unknown } }).cart_content?.data_ref;
    return { status: "added", message: `${p.added} pneu(s) ajouté(s) au panier de la session serveur DDA (non visible dans votre navigateur).`, cartId, dataRef: dataRef != null ? String(dataRef) : null, total: p.total };
  }
  return p.status === "refused" ? { status: "refused", message: `Districash a refusé : ${p.message}` } : { status: "uncertain", message: p.message };
}
