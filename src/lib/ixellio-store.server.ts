/**
 * Stockage chiffré des identifiants IXELLIO + interrogation véhicule côté serveur.
 * Les identifiants ne sortent jamais de ce module : ni logs, ni réponses HTTP.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { decryptSecret, encryptSecret } from "./crypto.server";
import { runIxellioAuthTest, type IxellioTestResult } from "./ixellio.server";

const PROVIDER = "ixellio";

export async function saveIxellioCredentials(
  username: string,
  password: string,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("integration_credentials").upsert(
    {
      provider: PROVIDER,
      username_enc: encryptSecret(username),
      password_enc: encryptSecret(password),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) throw new Error("Enregistrement des identifiants impossible.");
}

export async function getIxellioStatus(): Promise<{ configured: boolean; updatedAt: string | null }> {
  const { data } = await supabaseAdmin
    .from("integration_credentials")
    .select("updated_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  return { configured: Boolean(data), updatedAt: data?.updated_at ?? null };
}

export async function clearIxellioCredentials(): Promise<void> {
  await supabaseAdmin.from("integration_credentials").delete().eq("provider", PROVIDER);
}

/** Renvoie les identifiants déchiffrés (usage interne serveur uniquement). */
async function loadCredentials(): Promise<{ username: string; password: string } | null> {
  const { data } = await supabaseAdmin
    .from("integration_credentials")
    .select("username_enc, password_enc")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data) return null;
  try {
    return { username: decryptSecret(data.username_enc), password: decryptSecret(data.password_enc) };
  } catch {
    throw new Error("Identifiants IXELLIO illisibles : réenregistrez-les dans Paramétrage global.");
  }
}

const NOT_CONFIGURED =
  "IXELLIO n'est pas configuré. Renseignez les identifiants dans Paramétrage → Paramétrage global.";

export const IXELLIO_NOT_CONFIGURED = NOT_CONFIGURED;

/**
 * Licence mono-session : si le premier login est refusé, on retente une seule
 * fois avec un cookie jar neuf (runIxellioAuthTest en repart systématiquement).
 */
export async function runIxellioWithStoredCredentials(
  plate: string,
  override?: { username: string; password: string },
): Promise<IxellioTestResult & { notConfigured?: boolean }> {
  const creds = override ?? (await loadCredentials());
  if (!creds) {
    return {
      outcome: "unexpected_response",
      authenticated: false,
      loginStatus: null,
      searchStatus: null,
      loginRedirect: null,
      searchRedirect: null,
      trace: [],
      durationMs: 0,
      bytes: 0,
      vehicle: {},
      detectedFields: [],
      fieldCount: 0,
      pairCount: 0,
      isVersionList: false,
      message: NOT_CONFIGURED,
      notConfigured: true,
    };
  }

  let last = await runIxellioAuthTest({ ...creds, plate });
  if (last.outcome === "auth_refused" || last.outcome === "redirect_to_login") {
    last.trace.push("2e tentative de connexion (cookie jar neuf)…");
    const retry = await runIxellioAuthTest({ ...creds, plate });
    retry.trace = [...last.trace, ...retry.trace];
    last = retry;
  }
  return last;
}
