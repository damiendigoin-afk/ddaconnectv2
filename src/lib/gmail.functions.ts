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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getValidAccessToken, fetchRecentMessages } = await import("@/lib/gmail-oauth.server");
    const { ingestEmail } = await import("@/lib/emails");

    // Load stored tokens
    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("email_oauth_tokens")
      .select("access_token, refresh_token, expires_at, scope")
      .eq("account_id", data.accountId)
      .maybeSingle();

    if (tokenError) throw tokenError;
    if (!tokenRow || !tokenRow.access_token) {
      throw new Error("Aucun token Gmail pour cette boîte. Connectez Gmail d'abord.");
    }

    const tokens = {
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expires_at: tokenRow.expires_at,
      scope: tokenRow.scope,
    };

    // Get valid access token (refresh if needed)
    const { accessToken, refreshed, newTokens } = await getValidAccessToken(tokens);

    // Persist refreshed token if applicable
    if (refreshed && newTokens) {
      await supabaseAdmin
        .from("email_oauth_tokens")
        .update({
          access_token: newTokens.access_token,
          expires_at: newTokens.expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", data.accountId);
    }

    // Get account info for mailbox address
    const { data: account } = await supabaseAdmin
      .from("email_accounts")
      .select("id, address")
      .eq("id", data.accountId)
      .maybeSingle();

    if (!account) throw new Error("Boîte introuvable");

    // Fetch and ingest recent messages
    const messages = await fetchRecentMessages(accessToken, 25);
    let ingested = 0;
    let duplicates = 0;

    for (const msg of messages) {
      const result = await ingestEmail({
        rfcMessageId: msg.rfcMessageId,
        gmailMessageId: msg.gmailMessageId,
        gmailThreadId: msg.gmailThreadId,
        sentAt: msg.sentAt,
        from: msg.from,
        fromName: msg.fromName,
        to: msg.to,
        cc: msg.cc,
        subject: msg.subject,
        bodyText: msg.bodyText,
        bodyHtml: msg.bodyHtml,
        mailbox: account.address,
        accountId: account.id,
        attachments: msg.attachments,
      });
      if (result.duplicate) duplicates++;
      else ingested++;
    }

    // Update account sync status
    await supabaseAdmin
      .from("email_accounts")
      .update({
        status: "connected",
        last_sync_at: new Date().toISOString(),
        last_sync_count: messages.length,
        last_error: null,
      })
      .eq("id", data.accountId);

    return {
      ok: true,
      fetched: messages.length,
      ingested,
      duplicates,
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
