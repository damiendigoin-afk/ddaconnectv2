/** Ajout au panier Districash d'une commande interne `to_transmit` (jamais de commande fournisseur). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  orderId: z.string().uuid(),
  /** Site sur lequel l'utilisateur a créé / voit la commande (jamais déduit côté serveur d'un autre onglet). */
  siteId: z.string().uuid(),
  confirmed: z.literal(true),
  allowExistingInCart: z.boolean().default(false),
});

export const addOrderToDistricashCart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // Lecture sous RLS : l'utilisateur doit avoir accès à la commande / au site.
    const { data: o } = await sb
      .from("part_orders")
      .select("id, site_id, status, supplier_account, source_quote, sites(code), part_order_lines(physical_reference, qty_ordered, expected_unit_cost_ht)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!o) return { status: "refused" as const, message: "Commande introuvable ou non autorisée." };
    if (o.status !== "to_transmit") return { status: "refused" as const, message: "Seule une commande « À transmettre » peut être ajoutée au panier." };

    const { checkCartSiteBinding } = await import("./tire-supplier-order");
    const site = (o as unknown as { sites: { code: string } | null }).sites;
    const { data: canAccess } = await sb.rpc("user_can_access_site", { _user_id: context.userId, _site_id: o.site_id });
    const bind = checkCartSiteBinding({ orderSiteId: o.site_id, orderSiteCode: site?.code, requestedSiteId: data.siteId, userCanAccess: canAccess === true, orderAccount: o.supplier_account });
    if (!bind.ok) return { status: "refused" as const, message: bind.message };
    const account = bind.account;

    const line = (o.part_order_lines ?? [])[0];
    const { safeDistricashProductUrl, districashProvider } = await import("./districash");
    const productUrl = safeDistricashProductUrl((o.source_quote as { product_url?: string } | null)?.product_url ?? null);
    if (!line?.physical_reference || !line.qty_ordered || line.expected_unit_cost_ht == null || !productUrl)
      return { status: "refused" as const, message: "Fiche produit Districash ou ligne incomplète : ajout impossible." };

    // Anti-doublon : un ajout déjà fait ou incertain bloque toute relance.
    const { data: prev } = await sb.from("parts_events").select("action").eq("entity", "part_order").eq("entity_id", o.id).in("action", ["cart_added", "cart_uncertain"]).limit(1);
    if (prev?.length) return { status: "refused" as const, message: "Un ajout au panier a déjà été tenté pour cette commande : vérifiez le panier Districash." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./crypto.server");
    const { data: c } = await supabaseAdmin.from("integration_credentials").select("username_enc, password_enc").eq("provider", districashProvider(o.site_id)).maybeSingle();
    if (!c?.username_enc || !c?.password_enc) return { status: "refused" as const, message: "Aucun identifiant Districash pour ce site." };

    const sess = await import("./districash-session.server");
    const { addToDistricashCart } = await import("./districash-cart-flow");
    let jar: import("./districash-session.server").Jar | null = null;
    const r = await addToDistricashCart(
      {
        open: async () => {
          const s = await sess.openDistricashSession(decryptSecret(c.username_enc!), decryptSecret(c.password_enc!));
          jar = s.jar;
          return { token: s.token, blocker: s.blocker };
        },
        get: async (path) => {
          const res = await sess.cartRequest(jar!, path, { headers: { Accept: "text/html" } });
          return { status: res.status, text: await res.text() };
        },
        post: async (path, body, csrf) => {
          const res = await sess.cartRequest(jar!, path, {
            method: "POST",
            body,
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf, Origin: `https://${sess.DISTRICASH_HOST}`, Referer: productUrl },
          });
          return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
        },
      },
      { productUrl, code: line.physical_reference, quantity: line.qty_ordered, purchaseHt: Number(line.expected_unit_cost_ht), allowExistingInCart: data.allowExistingInCart },
    ).catch(() => ({ status: "uncertain" as const, message: "Erreur pendant l'ajout : vérifiez le panier, sans relancer." }));

    const action = r.status === "added" ? "cart_added" : r.status === "uncertain" ? "cart_uncertain" : r.status === "already_in_cart" ? "cart_already" : "cart_refused";
    await sb.from("parts_events").insert({
      site_id: o.site_id, entity: "part_order", entity_id: o.id, action,
      detail: { supplier: "districash", account, message: r.message, ...(r.status === "added" ? { data_ref: r.dataRef, total: r.total } : {}) } as never,
      created_by_name: (context.claims as { email?: string }).email ?? "",
    });
    // Le statut de la commande reste « to_transmit » : seul un n° de commande réel la fait passer « Commandée ».
    return { ...r, message: `Panier ${bind.label} : ${r.message}` };
  });
