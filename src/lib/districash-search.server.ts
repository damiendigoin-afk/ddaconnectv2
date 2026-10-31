/**
 * Recherche Districash lecture seule pour UN site (compte du site, jamais un
 * autre). Partagée par la fonction serveur authentifiée et la façade web.
 */
export async function districashSearchForSite(
  siteId: string,
  dims: { width: string; height: string; diameter: string; load?: string | null | undefined; speed?: string | null | undefined },
  quantity: number,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./crypto.server");
  const { districashLoginAndSearch, summarizeDistricashTest } = await import("./districash-session.server");
  const { districashProvider } = await import("./districash");
  const { data: c } = await supabaseAdmin
    .from("integration_credentials")
    .select("username_enc, password_enc")
    .eq("provider", districashProvider(siteId))
    .maybeSingle();
  if (!c?.username_enc || !c?.password_enc)
    return { ok: false as const, error: "Districash : aucun identifiant enregistré pour ce site.", rows: [], consultedAt: "" };
  try {
    const r = await districashLoginAndSearch(
      decryptSecret(c.username_enc),
      decryptSecret(c.password_enc),
      { width: dims.width, height: dims.height, diameter: dims.diameter, load: dims.load ?? "", speed: dims.speed ?? "" },
      quantity,
    );
    const s = summarizeDistricashTest(r);
    if (!r.authenticated) return { ok: false as const, error: `Districash : ${s.message}`, rows: [], consultedAt: "" };
    // Lignes brutes renvoyées au moteur ; le filtrage J/J+ est fait côté moteur (quotableDistricashRows).
    return { ok: true as const, error: "", rows: r.rows, consultedAt: new Date().toISOString() };
  } catch {
    return { ok: false as const, error: "Districash injoignable depuis le serveur.", rows: [], consultedAt: "" };
  }
}
