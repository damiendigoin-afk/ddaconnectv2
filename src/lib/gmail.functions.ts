import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions for Gmail OAuth integration (Lot 4).
 *
 * - getGmailAuthUrl: returns the Google consent URL for a given account
 * - syncGmailAccount: fetches recent messages and ingests them
 * - disconnectGmail: removes stored OAuth tokens
 * - getGmailStatus: checks if a mailbox has valid tokens
 *
 * These are public (no requireSupabaseAuth) because the OAuth callback is
 * an external redirect and the sync is triggered by managers. The account_id
 * is validated against the signed state parameter.
 */

export const getGmailAuthUrl = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ accountId: z.string().uuid(), origin: z.string().url() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { generateAuthUrl } = await import("@/lib/gmail-oauth.server");
    const redirectUri = `${data.origin}/api/public/gmail/callback`;
    const url = generateAuthUrl(data.accountId, redirectUri);
    return { url };
  });

export const syncGmailAccount = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { syncGmailAccountServer } = await import("@/lib/gmail-sync.server");
    const res = await syncGmailAccountServer(data.accountId);
    if (res.error) throw new Error(res.error);
    return {
      ok: true,
      fetched: res.fetched,
      ingested: res.ingested,
      duplicates: res.duplicates,
      backfillRemaining: res.backfillRemaining,
    };
  });

/** Synchronise toutes les boîtes Gmail connectées (bouton manager + automatisation). */
export const syncAllGmailAccounts = createServerFn({ method: "POST" })
  .handler(async () => {
    const { syncAllGmailAccountsServer } = await import("@/lib/gmail-sync.server");
    const res = await syncAllGmailAccountsServer();
    return {
      ok: true,
      accounts: res.accounts,
      fetched: res.fetched,
      ingested: res.ingested,
      duplicates: res.duplicates,
      errors: res.errors,
      backfillRemaining: res.backfillRemaining,
      details: res.details.map((d) => ({
        address: d.address,
        fetched: d.fetched,
        ingested: d.ingested,
        duplicates: d.duplicates,
        error: d.error,
      })),
    };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("email_oauth_tokens")
      .delete()
      .eq("account_id", data.accountId);
    if (error) throw error;

    await supabaseAdmin
      .from("email_accounts")
      .update({ status: "paused", gmail_connected: false })
      .eq("id", data.accountId);

    return { ok: true };
  });

export const getGmailConnectionStatus = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tokenRow } = await supabaseAdmin
      .from("email_oauth_tokens")
      .select("access_token, expires_at")
      .eq("account_id", data.accountId)
      .maybeSingle();

    const connected = !!(tokenRow && tokenRow.access_token);
    const expired = connected && tokenRow!.expires_at
      ? new Date(tokenRow!.expires_at).getTime() < Date.now()
      : false;

    return { connected, expired };
  });
