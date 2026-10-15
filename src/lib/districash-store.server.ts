/**
 * Identifiants Districash par site, chiffrés AES-256-GCM dans integration_credentials
 * (RLS sans politique : inaccessible au navigateur). Jamais renvoyés, jamais journalisés.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { encryptSecret } from "./crypto.server";
import { DISTRICASH_BLOCKED, districashProvider } from "./districash";

export type DistricashSiteStatus = {
  siteId: string;
  siteName: string;
  account: string | null;
  configured: boolean;
  updatedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
};

export async function listDistricashStatus(): Promise<DistricashSiteStatus[]> {
  const [{ data: sites }, { data: settings }, { data: creds }] = await Promise.all([
    supabaseAdmin.from("sites").select("id, name, code").eq("active", true).order("name"),
    supabaseAdmin.from("tire_supplier_site_settings").select("*"),
    supabaseAdmin.from("integration_credentials").select("provider, updated_at").like("provider", "districash:%"),
  ]);
  return (sites ?? []).map((s) => {
    const st = (settings ?? []).find((x) => x.site_id === s.id);
    const c = (creds ?? []).find((x) => x.provider === districashProvider(s.id));
    return {
      siteId: s.id,
      siteName: s.code === "dda" ? "Lalinde" : s.name,
      account: st?.districash_account ?? null,
      configured: Boolean(c),
      updatedAt: c?.updated_at ?? null,
      lastTestAt: st?.districash_last_test_at ?? null,
      lastTestOk: st?.districash_last_test_ok ?? null,
      lastTestMessage: st?.districash_last_test_message ?? null,
    };
  });
}

async function recordTest(siteId: string, ok: boolean | null, message: string) {
  await supabaseAdmin.from("tire_supplier_site_settings").upsert(
    {
      site_id: siteId,
      districash_last_test_at: new Date().toISOString(),
      districash_last_test_ok: ok,
      districash_last_test_message: message,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "site_id" },
  );
}

export async function saveDistricashCredentials(siteId: string, username: string, password: string, userId: string) {
  const { error } = await supabaseAdmin.from("integration_credentials").upsert(
    {
      provider: districashProvider(siteId),
      username_enc: encryptSecret(username),
      password_enc: encryptSecret(password),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) throw new Error("Enregistrement des identifiants impossible.");
  // Nouveaux identifiants : l'ancien résultat de test ne s'applique plus.
  await supabaseAdmin
    .from("tire_supplier_site_settings")
    .update({ districash_last_test_at: null, districash_last_test_ok: null, districash_last_test_message: null })
    .eq("site_id", siteId);
}

export async function clearDistricashCredentials(siteId: string) {
  await supabaseAdmin.from("integration_credentials").delete().eq("provider", districashProvider(siteId));
}

/**
 * Test : les identifiants ne sont envoyés nulle part (endpoint d'authentification
 * non documenté). On vérifie seulement que le portail répond (GET public sans
 * identifiants) et on conserve l'état « connexion non validée ». Aucun succès inventé.
 */
export async function testDistricash(siteId: string): Promise<{ ok: boolean | null; message: string }> {
  const { data: c } = await supabaseAdmin
    .from("integration_credentials")
    .select("provider")
    .eq("provider", districashProvider(siteId))
    .maybeSingle();
  if (!c) return { ok: null, message: "Aucun identifiant enregistré pour ce site." };
  let message: string;
  let ok: boolean | null = null;
  try {
    const res = await fetch("https://districashv2.inoshop.net/", { method: "GET", redirect: "manual" });
    message = `Portail joignable (HTTP ${res.status}). ${DISTRICASH_BLOCKED}`;
  } catch {
    ok = false;
    message = "Portail Districash injoignable depuis le serveur.";
  }
  await recordTest(siteId, ok, message);
  return { ok, message };
}
