/**
 * Ajout au panier Districash (POST /cart/store) — PRÉPARATION UNIQUEMENT.
 *
 * DÉSACTIVÉ : la provenance exacte des champs du formulaire (id, scenario,
 * identifiant_administratif, code_agence, type_erp…) dans le HTML /search
 * n'est pas confirmée. On n'extrait que des valeurs lues littéralement dans la
 * ligne produit (input name= / data-*), jamais de valeur par défaut ni d'exemple
 * codé en dur ; si un champ manque ou contredit l'offre → refus.
 * Aucun appel réseau ici. /cart/order, /cart/payment, /order/registered interdits.
 */
export const DISTRICASH_CART_ENABLED = false;

export const CART_STORE_FIELDS = [
  "quantite", "mode_modal", "origin", "id", "gencode", "c_fourn_cata", "c_fourn", "code_article",
  "code_article_fournisseur", "code_marque", "platform_img", "platform_libdispo", "platform_libdispobtn",
  "prix_achat", "prix_vente", "devise", "consigne", "code_fam", "code_sfam", "code_ean", "code_supplier",
  "libelle_article", "identifiant_administratif", "type_erp", "code_agence", "scenario",
] as const;
export type CartStoreField = (typeof CART_STORE_FIELDS)[number];

/** Champs pouvant légitimement être vides côté portail. */
const OPTIONAL = new Set<CartStoreField>(["platform_img", "consigne", "mode_modal", "c_fourn_cata"]);

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Lit un champ par nom exact : <input name="x" value="…"> ou data-x="…". */
function readField(html: string, name: string): string | null {
  const esc = name.replace(/[-_]/g, (c) => `\\${c}`);
  const input = new RegExp(`<input\\b[^>]*\\bname\\s*=\\s*"${esc}"[^>]*>`, "i").exec(html)?.[0];
  if (input) {
    const v = /\bvalue\s*=\s*"([^"]*)"/i.exec(input);
    return v ? decode(v[1]!) : "";
  }
  const d = new RegExp(`\\bdata-${esc}\\s*=\\s*"([^"]*)"`, "i").exec(html);
  return d ? decode(d[1]!) : null;
}

export type CartCheck = { code: string; ean: string | null; quantity: number; purchaseHt: number; availability: string };

export function buildCartStorePayload(
  rowHtml: string,
  csrf: string,
  check: CartCheck,
): { ok: true; body: URLSearchParams } | { ok: false; reason: string } {
  if (!csrf) return { ok: false, reason: "Jeton de session absent." };
  if (check.availability !== "J" && check.availability !== "J+") return { ok: false, reason: "Article non disponible J/J+." };
  if (!Number.isInteger(check.quantity) || check.quantity < 1 || check.quantity > 20) return { ok: false, reason: "Quantité invalide." };
  const body = new URLSearchParams({ _token: csrf });
  for (const f of CART_STORE_FIELDS) {
    if (f === "quantite") { body.set(f, String(check.quantity)); continue; }
    const v = readField(rowHtml, f);
    if (v == null || (v.trim() === "" && !OPTIONAL.has(f))) return { ok: false, reason: `Champ portail introuvable : ${f}.` };
    body.set(f, v);
  }
  const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");
  if (norm(body.get("code_article")) !== norm(check.code)) return { ok: false, reason: "Référence article différente de l'offre." };
  if (check.ean && norm(body.get("code_ean")) !== norm(check.ean)) return { ok: false, reason: "EAN différent de l'offre." };
  const pa = Number((body.get("prix_achat") ?? "").replace(",", "."));
  if (!Number.isFinite(pa) || Math.abs(pa - check.purchaseHt) > 0.005) return { ok: false, reason: "Prix d'achat changé : revérifiez l'offre." };
  return { ok: true, body };
}

/** Lecture d'une réponse /cart/store : succès seulement si nb_added > 0 prouvé. */
export function parseCartStoreResponse(json: unknown): { status: "added"; added: number; total: string | null } | { status: "refused" | "unknown"; message: string } {
  if (!json || typeof json !== "object") return { status: "unknown", message: "Réponse illisible : vérifiez le panier sur le portail, sans renvoyer." };
  const c = (json as { cart_content?: { nb_added?: unknown; price_total?: unknown } }).cart_content;
  const n = Number(c?.nb_added);
  if (Number.isFinite(n) && n > 0) return { status: "added", added: n, total: c?.price_total != null ? String(c.price_total) : null };
  const err = (json as { error_message?: unknown }).error_message;
  if (typeof err === "string" && err) return { status: "refused", message: err };
  return { status: "unknown", message: "Ajout non prouvé : vérifiez le panier sur le portail, sans renvoyer." };
}
