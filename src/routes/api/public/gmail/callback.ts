import { createFileRoute } from "@tanstack/react-router";

/**
 * Gmail OAuth callback route.
 *
 * Google redirects here after the user grants consent. We verify the state,
 * exchange the code for tokens, persist them, and redirect back to /emails.
 *
 * Public route (no auth) — the state parameter is HMAC-signed to prevent CSRF.
 */
export const Route = createFileRoute("/api/public/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        const error = url.searchParams.get("error");

        // User denied consent
        if (error) {
          return redirectTo(`/emails?gmail_error=${encodeURIComponent(error)}`);
        }
        if (!code) {
          return redirectTo("/emails?gmail_error=missing_code");
        }

        const { verifyState, exchangeCode } = await import("@/lib/gmail-oauth.server");
        const accountId = verifyState(state);
        if (!accountId) {
          return redirectTo("/emails?gmail_error=invalid_state");
        }

        // Reconstruct the exact redirect URI used for the auth request
        const redirectUri = `${url.origin}/api/public/gmail/callback`;

        try {
          const tokens = await exchangeCode(code, redirectUri);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Upsert tokens
          const { error: upsertError } = await supabaseAdmin
            .from("email_oauth_tokens")
            .upsert(
              {
                account_id: accountId,
                provider: "gmail",
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: tokens.expires_at,
                scope: tokens.scope,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "account_id" },
            );
          if (upsertError) {
            return redirectTo(`/emails?gmail_error=${encodeURIComponent(upsertError.message)}`);
          }

          // Mark account as connected
          await supabaseAdmin
            .from("email_accounts")
            .update({
              status: "connected",
              last_sync_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", accountId);

          return redirectTo("/emails?gmail_connected=1");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return redirectTo(`/emails?gmail_error=${encodeURIComponent(msg)}`);
        }
      },
    },
  },
});

function redirectTo(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: path },
  });
}
