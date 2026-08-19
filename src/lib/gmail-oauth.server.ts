/**
 * Server-only Gmail OAuth helpers.
 *
 * Implements the OAuth 2.0 flow for Gmail API access (per-mailbox):
 *  - generateAuthUrl: builds the Google consent URL
 *  - exchangeCode: swaps the authorization code for access+refresh tokens
 *  - refreshAccessToken: refreshes an expired access token
 *  - fetchRecentMessages: lists and fetches recent Gmail messages
 *  - parseGmailMessage: extracts headers + body from a Gmail message payload
 *
 * Scopes: gmail.readonly (read) + gmail.modify (mark read/unread).
 * Tokens are stored in public.email_oauth_tokens keyed by account_id.
 *
 * This module is server-only — import it only inside server functions or
 * server route handlers.
 */

import { createHmac, timingSafeEqual } from "crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

export interface GmailTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}

export function getClientId(): string {
  const id = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
  return id;
}

function getClientSecret(): string {
  const secret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!secret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured");
  return secret;
}

/** Build a signed state parameter encoding the account_id. */
export function makeState(accountId: string): string {
  const hmac = createHmac("sha256", getClientSecret()).update(accountId).digest("hex");
  return `${accountId}.${hmac}`;
}

/** Verify the state parameter and return the account_id. */
export function verifyState(state: string): string | null {
  const idx = state.lastIndexOf(".");
  if (idx < 1) return null;
  const accountId = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  const expected = createHmac("sha256", getClientSecret()).update(accountId).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return accountId;
}

/** Build the Google consent URL. */
export function generateAuthUrl(accountId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: makeState(accountId),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<GmailTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${data.error ?? res.statusText}`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: expiresAt,
    scope: data.scope ?? null,
  };
}

/** Refresh an expired access token. Returns new tokens. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_at: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${data.error ?? res.statusText}`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/** Get a valid access token for an account, refreshing if needed. */
export async function getValidAccessToken(
  tokens: GmailTokens,
): Promise<{ accessToken: string; refreshed: boolean; newTokens?: Partial<GmailTokens> }> {
  const now = Date.now();
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  // Refresh if token expires within 60 seconds
  if (expiresAt - now > 60000) {
    return { accessToken: tokens.access_token, refreshed: false };
  }
  if (!tokens.refresh_token) {
    throw new Error("Access token expired and no refresh token available. Reconnect Gmail.");
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return {
    accessToken: refreshed.access_token,
    refreshed: true,
    newTokens: { access_token: refreshed.access_token, expires_at: refreshed.expires_at },
  };
}

/** Decode base64url to UTF-8 string. */
function decodeBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const normalized = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(normalized, "base64").toString("utf-8");
}

/** Extract text body from a Gmail message payload (handles multipart). */
function extractBody(
  payload: { body?: { data?: string }; parts?: any[] },
  mimeType: "text/plain" | "text/html",
): string | null {
  if (!payload) return null;
  if (payload.body?.data && payload.mimeType === mimeType) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === mimeType && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      // Recurse into nested multipart
      const nested = extractBody(part, mimeType);
      if (nested) return nested;
    }
  }
  return null;
}

/** Get a header value from a Gmail message. */
function getHeader(headers: { name: string; value: string }[] | undefined, name: string): string | null {
  if (!headers) return null;
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** Parse a Gmail message into a normalized structure. */
export interface ParsedGmailMessage {
  gmailMessageId: string;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  sentAt: string;
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: { filename: string; mimeType: string | null; sizeBytes: number | null }[];
}

function parseAddresses(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse "Name <email@domain>" into name and email. */
function splitFrom(fromValue: string | null): { from: string; fromName: string | null } {
  if (!fromValue) return { from: "", fromName: null };
  const match = fromValue.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, "");
    return { from: match[2].trim(), fromName: name || null };
  }
  return { from: fromValue.trim(), fromName: null };
}

export function parseGmailMessage(msg: any): ParsedGmailMessage | null {
  if (!msg || !msg.id) return null;
  const headers = msg.payload?.headers;
  const fromValue = getHeader(headers, "From");
  const { from, fromName } = splitFrom(fromValue);
  const dateStr = getHeader(headers, "Date");
  const sentAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

  const attachments: ParsedGmailMessage["attachments"] = [];
  function collectParts(parts: any[]) {
    for (const part of parts) {
      if (part.filename) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType ?? null,
          sizeBytes: part.body?.size ?? null,
        });
      }
      if (part.parts) collectParts(part.parts);
    }
  }
  if (msg.payload?.parts) collectParts(msg.payload.parts);

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId ?? null,
    rfcMessageId: getHeader(headers, "Message-ID"),
    sentAt,
    from,
    fromName,
    to: parseAddresses(getHeader(headers, "To")),
    cc: parseAddresses(getHeader(headers, "Cc")),
    subject: getHeader(headers, "Subject"),
    bodyText: extractBody(msg.payload, "text/plain"),
    bodyHtml: extractBody(msg.payload, "text/html"),
    attachments,
  };
}

/** Fetch recent messages from Gmail (up to max). */
export async function fetchRecentMessages(
  accessToken: string,
  max: number = 25,
): Promise<ParsedGmailMessage[]> {
  // List message IDs
  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=${max}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Gmail list failed [${listRes.status}]: ${err}`);
  }
  const listData = await listRes.json();
  const messageIds: string[] = (listData.messages ?? []).map((m: any) => m.id);
  if (!messageIds.length) return [];

  // Fetch each message (batch — sequential to avoid rate limits, but limited count)
  const results: ParsedGmailMessage[] = [];
  for (const id of messageIds) {
    const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) {
      console.error(`Gmail get ${id} failed [${msgRes.status}]`);
      continue;
    }
    const msg = await msgRes.json();
    const parsed = parseGmailMessage(msg);
    if (parsed) results.push(parsed);
  }
  return results;
}

/** Get the Gmail profile (email address of the connected account). */
export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile failed [${res.status}]`);
  return res.json();
}
