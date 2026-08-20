/**
 * Server-only Gmail synchronisation engine.
 *
 * Deux phases par boîte :
 *  1. Incrémentale — parcourt les pages Gmail les plus récentes tant qu'elles
 *     contiennent des messages inconnus (arrêt dès qu'une page est entièrement
 *     déjà importée, ou quand le budget de la passe est épuisé).
 *  2. Backfill historique — reprend là où la passe précédente s'est arrêtée
 *     (email_accounts.backfill_page_token) et traite un lot borné, afin de
 *     rattraper l'historique sur plusieurs exécutions sans timeout.
 *
 * La déduplication reste assurée par le fingerprint + email_receipts côté
 * ingestion ; on filtre en amont sur gmail_message_id pour éviter des appels
 * Gmail inutiles.
 */

import { listMessageIds, getMessage, parseGmailMessage } from "@/lib/gmail-oauth.server";
import { ingestEmailServer } from "@/lib/emails-ingest.server";

export interface AccountSyncResult {
  accountId: string;
  address: string;
  fetched: number;
  ingested: number;
  duplicates: number;
  backfillRemaining: boolean;
  error: string | null;
}

export interface SyncBudget {
  /** Nombre maximum de nouveaux messages traités en phase incrémentale. */
  maxIncremental?: number;
  /** Nombre maximum de messages traités en phase de backfill historique. */
  maxBackfill?: number;
}

const PAGE_SIZE = 100;

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function knownIds(admin: Admin, accountId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await admin
    .from("email_receipts")
    .select("gmail_message_id")
    .eq("account_id", accountId)
    .in("gmail_message_id", ids);
  return new Set(
    ((data ?? []) as { gmail_message_id: string | null }[])
      .map((r) => r.gmail_message_id)
      .filter((v): v is string => !!v),
  );
}

/** Synchronise une boîte Gmail. Ne lève pas : les erreurs sont renvoyées dans le résultat. */
export async function syncGmailAccountServer(
  accountId: string,
  budget: SyncBudget = {},
): Promise<AccountSyncResult> {
  const maxIncremental = budget.maxIncremental ?? 250;
  const maxBackfill = budget.maxBackfill ?? 150;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as Admin;

  const result: AccountSyncResult = {
    accountId,
    address: "",
    fetched: 0,
    ingested: 0,
    duplicates: 0,
    backfillRemaining: false,
    error: null,
  };

  try {
    const { data: account, error: accErr } = await admin
      .from("email_accounts")
      .select("id, address, backfill_page_token, backfill_complete")
      .eq("id", accountId)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!account) throw new Error("Boîte introuvable");
    result.address = account.address;

    const { data: tokenRow, error: tokenError } = await admin
      .from("email_oauth_tokens")
      .select("access_token, refresh_token, expires_at, scope")
      .eq("account_id", accountId)
      .maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow?.access_token) {
      throw new Error("Aucun token Gmail pour cette boîte. Reconnectez Gmail.");
    }

    const { getValidAccessToken } = await import("@/lib/gmail-oauth.server");
    const { accessToken, refreshed, newTokens } = await getValidAccessToken({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expires_at: tokenRow.expires_at,
      scope: tokenRow.scope,
    });
    if (refreshed && newTokens) {
      await admin
        .from("email_oauth_tokens")
        .update({
          access_token: newTokens.access_token ?? null,
          expires_at: newTokens.expires_at ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId);
    }

    const processIds = async (ids: string[]): Promise<number> => {
      const already = await knownIds(admin, accountId, ids);
      const fresh = ids.filter((id) => !already.has(id));
      for (const id of fresh) {
        const msg = await getMessage(accessToken, id);
        const parsed = msg ? parseGmailMessage(msg) : null;
        if (!parsed) continue;
        result.fetched += 1;
        const ing = await ingestEmailServer({
          rfcMessageId: parsed.rfcMessageId,
          gmailMessageId: parsed.gmailMessageId,
          gmailThreadId: parsed.gmailThreadId,
          sentAt: parsed.sentAt,
          from: parsed.from,
          fromName: parsed.fromName,
          to: parsed.to,
          cc: parsed.cc,
          subject: parsed.subject,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          mailbox: account.address,
          accountId,
          attachments: parsed.attachments,
        });
        if (ing.duplicate) result.duplicates += 1;
        else result.ingested += 1;
      }
      return fresh.length;
    };

    // --- Phase 1 : incrémentale (toujours en premier) ---
    let pageToken: string | undefined;
    let processedIncremental = 0;
    for (let page = 0; page < 20; page++) {
      const list = await listMessageIds(accessToken, { pageToken, maxResults: PAGE_SIZE });
      if (!list.ids.length) break;
      const fresh = await processIds(list.ids);
      processedIncremental += fresh;
      // Page entièrement déjà connue → plus rien de neuf au-delà.
      if (fresh === 0) break;
      if (processedIncremental >= maxIncremental) break;
      if (!list.nextPageToken) break;
      pageToken = list.nextPageToken;
    }

    // --- Phase 2 : backfill historique borné ---
    if (!account.backfill_complete) {
      let token: string | undefined = account.backfill_page_token ?? undefined;
      let processed = 0;
      let complete = false;
      for (let page = 0; page < 10 && processed < maxBackfill; page++) {
        const list: { ids: string[]; nextPageToken?: string } = await listMessageIds(accessToken, {
          pageToken: token,
          maxResults: PAGE_SIZE,
        });
        processed += await processIds(list.ids);
        if (!list.nextPageToken) {
          complete = true;
          token = undefined;
          break;
        }
        token = list.nextPageToken;
      }
      result.backfillRemaining = !complete;
      await admin
        .from("email_accounts")
        .update({ backfill_page_token: token ?? null, backfill_complete: complete })
        .eq("id", accountId);
    }

    await admin
      .from("email_accounts")
      .update({
        status: "connected",
        last_sync_at: new Date().toISOString(),
        last_sync_count: result.fetched,
        last_error: null,
      })
      .eq("id", accountId);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("email_accounts")
        .update({ last_sync_at: new Date().toISOString(), last_error: result.error })
        .eq("id", accountId);
    } catch {
      /* ignore */
    }
  }

  return result;
}

export interface SyncAllResult {
  accounts: number;
  fetched: number;
  ingested: number;
  duplicates: number;
  errors: number;
  backfillRemaining: boolean;
  details: AccountSyncResult[];
}

/** Synchronise toutes les boîtes Gmail connectées, séquentiellement. */
export async function syncAllGmailAccountsServer(budget: SyncBudget = {}): Promise<SyncAllResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("email_accounts")
    .select("id")
    .eq("gmail_connected", true)
    .in("status", ["connected", "actif", "active"]);
  if (error) throw error;

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const details: AccountSyncResult[] = [];
  for (const id of ids) {
    details.push(await syncGmailAccountServer(id, budget));
  }

  return {
    accounts: ids.length,
    fetched: details.reduce((s, d) => s + d.fetched, 0),
    ingested: details.reduce((s, d) => s + d.ingested, 0),
    duplicates: details.reduce((s, d) => s + d.duplicates, 0),
    errors: details.filter((d) => d.error).length,
    backfillRemaining: details.some((d) => d.backfillRemaining),
    details,
  };
}
