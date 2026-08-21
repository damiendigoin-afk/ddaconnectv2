/**
 * Accès client au devis interactif par jeton de partage.
 * Aucune session DDA Connect : la lecture et les réponses passent par le
 * serveur, jeton en main, sans exposer les tables publiquement.
 */
const RESPONSES = ["accepted", "refused", "later", "contact", "pending"] as const;
export type PublicResponse = (typeof RESPONSES)[number];

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type PublicQuoteLine = {
  id: string;
  block: string;
  label: string;
  detail: string | null;
  priority: string;
  needs_contact: boolean;
  total_ht: number;
  total_ttc: number;
  client_response: string;
  client_comment: string | null;
};

export async function loadPublicQuote(token: string) {
  const db = await admin();
  const { data: quote, error } = await db
    .from("pricing_quotes")
    .select("id, plate, status, total_ttc, created_at, share_token")
    .eq("share_token", token)
    .maybeSingle();
  if (error || !quote) return { ok: false as const, error: "Devis introuvable ou lien expiré." };
  const { data: lines } = await db
    .from("pricing_quote_lines")
    .select(
      "id, block, label, detail, priority, needs_contact, total_ht, total_ttc, client_response, client_comment",
    )
    .eq("quote_id", quote.id)
    .order("sort_order");
  return {
    ok: true as const,
    quote: { id: quote.id, plate: quote.plate, status: quote.status, createdAt: quote.created_at },
    lines: (lines ?? []) as PublicQuoteLine[],
  };
}

export async function respondPublicLine(args: {
  token: string;
  lineId: string;
  response: PublicResponse;
  comment?: string;
}) {
  if (!RESPONSES.includes(args.response)) return { ok: false as const, error: "Réponse invalide." };
  const db = await admin();
  const { data: quote } = await db
    .from("pricing_quotes")
    .select("id")
    .eq("share_token", args.token)
    .maybeSingle();
  if (!quote) return { ok: false as const, error: "Devis introuvable." };
  const { error } = await db
    .from("pricing_quote_lines")
    .update({
      client_response: args.response,
      client_comment: args.comment?.slice(0, 500) ?? null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", args.lineId)
    .eq("quote_id", quote.id);
  if (error) return { ok: false as const, error: "Enregistrement impossible." };

  const { data: lines } = await db
    .from("pricing_quote_lines")
    .select("total_ht, total_ttc, client_response")
    .eq("quote_id", quote.id);
  const kept = (lines ?? []).filter((l) => l.client_response !== "refused");
  await db
    .from("pricing_quotes")
    .update({
      total_ht: Math.round(kept.reduce((s, l) => s + Number(l.total_ht), 0) * 100) / 100,
      total_ttc: Math.round(kept.reduce((s, l) => s + Number(l.total_ttc), 0) * 100) / 100,
      status: "client_repondu",
    })
    .eq("id", quote.id);

  return loadPublicQuote(args.token);
}
