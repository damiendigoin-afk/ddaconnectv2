import { supabase } from "@/integrations/supabase/client";
import {
  categorizeEmail,
  emailFingerprint,
  messageKind,
  threadKeyOf,
  type EmailCategory,
} from "@/lib/emails-core";
import { dueAtFrom, expiresAtFrom, triageIncoming } from "@/lib/triage-core";


export type EmailAccount = {
  id: string;
  user_id: string | null;
  site_id: string | null;
  address: string;
  label: string | null;
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  gmail_connected: boolean;
};

export type EmailRow = {
  id: string;
  sent_at: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  kind: string;
  category: string;
  category_confidence: number;
  thread_key: string | null;
  gmail_thread_id: string | null;
  has_attachments: boolean;
  site_id: string | null;
  importance: string;
  urgency: string;
  action_required: boolean;
  human_required: boolean;
  services: string[];
  due_at: string | null;
  expires_at: string | null;
  triage_status: string;
  triage_confidence: string;
  triage_reason: string | null;
  receipts: { mailbox_address: string; person_name: string | null }[];
};

export async function fetchEmailAccounts(): Promise<EmailAccount[]> {
  const { data, error } = await supabase.from("email_accounts").select("*").order("address");
  if (error) throw error;
  return (data ?? []) as EmailAccount[];
}

export async function upsertEmailAccount(a: {
  address: string;
  label?: string | null;
  userId?: string | null;
  siteId?: string | null;
}) {
  const { error } = await supabase.from("email_accounts").upsert(
    {
      address: a.address.trim().toLowerCase(),
      label: a.label ?? null,
      user_id: a.userId ?? null,
      site_id: a.siteId ?? null,
    },
    { onConflict: "address" },
  );
  if (error) throw error;
}

export async function setAccountStatus(id: string, status: string) {
  const { error } = await supabase
    .from("email_accounts")
    .update({ status, ...(status === "connected" ? { last_sync_at: new Date().toISOString() } : {}) })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchEmails(opts: {
  search?: string;
  category?: string;
  mailbox?: string;
  siteId?: string | null;
  /** Filtre sur l'état de traitement (§4, §29). */
  triage?: string;
  /** §5 — les informations temporaires expirées sortent de la vue active. */
  includeExpired?: boolean;
  limit?: number;
}): Promise<EmailRow[]> {
  let q = supabase
    .from("emails")
    .select(
      "id, sent_at, from_address, from_name, to_addresses, cc_addresses, subject, snippet, body_text, kind, category, category_confidence, thread_key, gmail_thread_id, has_attachments, site_id, importance, urgency, action_required, human_required, services, due_at, expires_at, triage_status, triage_confidence, triage_reason, receipts:email_receipts(mailbox_address, person_name)",
    )
    .order("sent_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  if (opts.triage && opts.triage !== "all") {
    if (opts.triage === "a_faire") q = q.eq("action_required", true).in("triage_status", ["a_qualifier", "a_traiter", "en_cours"]);
    else q = q.eq("triage_status", opts.triage);
  }
  if (!opts.includeExpired) q = q.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (opts.siteId) q = q.eq("site_id", opts.siteId);
  if (opts.search && opts.search.trim().length > 1) {
    const s = `%${opts.search.trim()}%`;
    q = q.or(`subject.ilike.${s},from_address.ilike.${s},body_text.ilike.${s}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as unknown as EmailRow[];
  if (opts.mailbox && opts.mailbox !== "all") {
    rows = rows.filter((r) => r.receipts.some((x) => x.mailbox_address === opts.mailbox));
  }
  return rows;
}

export type IncomingEmail = {
  rfcMessageId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  sentAt: string;
  from: string;
  fromName?: string | null;
  to?: string[];
  cc?: string[];
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  mailbox: string;
  personName?: string | null;
  accountId?: string | null;
  siteId?: string | null;
  attachments?: { filename: string; mimeType?: string | null; sizeBytes?: number | null }[];
};

/**
 * Enregistre un email en une seule entrée métier.
 * Si le même email arrive dans plusieurs boîtes, seule la liste des réceptions grandit.
 */
export async function ingestEmail(e: IncomingEmail): Promise<{ emailId: string; duplicate: boolean }> {
  const fingerprint = emailFingerprint({
    rfcMessageId: e.rfcMessageId ?? null,
    from: e.from,
    subject: e.subject ?? null,
    sentAt: e.sentAt,
    body: e.bodyText ?? e.bodyHtml ?? null,
  });

  const existing = await supabase.from("emails").select("id").eq("fingerprint", fingerprint).maybeSingle();
  let emailId = existing.data?.id ?? null;
  const duplicate = !!emailId;

  if (!emailId) {
    const cat = categorizeEmail({ subject: e.subject, body: e.bodyText ?? e.bodyHtml, from: e.from });
    const tri = triageIncoming({
      subject: e.subject,
      body: e.bodyText ?? e.bodyHtml,
      from: e.from,
      hasAttachments: !!e.attachments?.length,
    });

    const { data, error } = await supabase
      .from("emails")
      .insert({
        fingerprint,
        rfc_message_id: e.rfcMessageId ?? null,
        gmail_thread_id: e.gmailThreadId ?? null,
        thread_key: threadKeyOf({ gmailThreadId: e.gmailThreadId ?? null, subject: e.subject, from: e.from }),
        sent_at: e.sentAt,
        from_address: e.from.toLowerCase(),
        from_name: e.fromName ?? null,
        to_addresses: e.to ?? [],
        cc_addresses: e.cc ?? [],
        subject: e.subject ?? null,
        snippet: (e.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
        body_text: e.bodyText ?? null,
        body_html: e.bodyHtml ?? null,
        kind: messageKind(e.subject),
        category: cat.category,
        category_confidence: cat.confidence,
        importance: tri.importance,
        urgency: tri.urgency,
        action_required: tri.actionRequired,
        human_required: tri.humanRequired,
        services: tri.services,
        due_at: dueAtFrom(e.sentAt, tri.dueInMinutes),
        expires_at: expiresAtFrom(e.sentAt, tri.expiresInDays),
        triage_status: tri.status,
        triage_confidence: tri.confidence,
        triage_reason: tri.reason,
        site_id: e.siteId ?? null,
        has_attachments: !!e.attachments?.length,
      })
      .select("id")
      .single();
    if (error) throw error;
    emailId = data.id;
    if (e.attachments?.length) {
      await supabase.from("email_attachments").insert(
        e.attachments.map((a) => ({
          email_id: emailId as string,
          filename: a.filename,
          mime_type: a.mimeType ?? null,
          size_bytes: a.sizeBytes ?? null,
        })),
      );
    }
  }

  await supabase.from("email_receipts").upsert(
    {
      email_id: emailId,
      account_id: e.accountId ?? null,
      mailbox_address: e.mailbox.toLowerCase(),
      person_name: e.personName ?? null,
      gmail_message_id: e.gmailMessageId ?? null,
    },
    { onConflict: "email_id,mailbox_address" },
  );

  return { emailId: emailId as string, duplicate };
}

export function receivedByLabel(row: EmailRow): string {
  const names = row.receipts.map((r) => r.person_name || r.mailbox_address.split("@")[0]);
  const unique = Array.from(new Set(names.filter(Boolean))) as string[];
  return unique.length ? `Reçu par : ${unique.join(", ")}` : "";
}

export type EmailStats = {
  today: number;
  week: number;
  byCategory: { category: EmailCategory | string; count: number }[];
  byMailbox: { mailbox: string; count: number }[];
  classifiedRate: number;
};

export function computeStats(rows: EmailRow[]): EmailStats {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const today = rows.filter((r) => now - new Date(r.sent_at).getTime() < day).length;
  const week = rows.filter((r) => now - new Date(r.sent_at).getTime() < 7 * day).length;
  const cat = new Map<string, number>();
  const box = new Map<string, number>();
  for (const r of rows) {
    cat.set(r.category, (cat.get(r.category) ?? 0) + 1);
    for (const rc of r.receipts) box.set(rc.mailbox_address, (box.get(rc.mailbox_address) ?? 0) + 1);
  }
  const classified = rows.filter((r) => r.category !== "autre").length;
  return {
    today,
    week,
    byCategory: [...cat.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byMailbox: [...box.entries()].map(([mailbox, count]) => ({ mailbox, count })).sort((a, b) => b.count - a.count),
    classifiedRate: rows.length ? Math.round((classified / rows.length) * 100) : 0,
  };
}
