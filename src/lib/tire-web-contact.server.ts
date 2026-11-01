/**
 * Demande de contact pneus simplifiée (POST /api/public/tyres/contact-request).
 *
 * Un seul e-mail au garage choisi, rien d'autre : aucun recalcul Top prix, aucun
 * PDF, aucune écriture prospect/CRM/archive, aucun mail client, aucune pièce
 * jointe. L'offre est relue depuis le devis déjà stocké (tire_web_quotes) ; le
 * navigateur ne fournit jamais de prix. Gardé par le même interrupteur que le
 * devis web (tire_web_quote_settings.enabled + allowed_origins), indépendant de
 * TYRES_V10_ENABLED. Succès UNIQUEMENT si le fournisseur e-mail accepte et
 * renvoie un identifiant. Idempotence : clé fournisseur stable dérivée du seul
 * requestId, corps d'e-mail déterministe (aucune date « maintenant ») =>
 * même requête rejouée = même envoi ; même requestId + autre contenu = conflit
 * fournisseur (409). Journaux sans donnée personnelle.
 */
import { z } from "zod";
import { corsHeaders, originAllowed, type WebQuoteCase, type WebQuoteConfig } from "./tire-web-api";
import { clientIp, err, json, readBounded, sha } from "./tire-web-facade.server";

export const CONTACT_MAX_BODY_BYTES = 4096;
export const CONTACT_QUOTA_IP_PER_HOUR = 5;
export const CONTACT_QUOTA_GLOBAL_PER_HOUR = 60;

/** Destinataires fixes validés par la direction (aucune lecture en base). */
export const CONTACT_RECIPIENTS = {
  castillon: { to: "contact@garagecastillon.fr", label: "Garage Castillon (Castels-et-Bézenac)" },
  lalinde: { to: "contact@dda-lalinde.fr", label: "DDA Lalinde" },
} as const;
export type ContactSite = keyof typeof CONTACT_RECIPIENTS;

export const contactRequestInput = z
  .object({
    requestId: z.string().uuid(),
    quoteId: z.string().uuid(),
    tier: z.enum(["entree", "milieu", "haut"]),
    season: z.enum(["ete", "quatre_saisons"]),
    site: z.enum(["castillon", "lalinde"]),
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().max(255).email(),
    phone: z.string().trim().min(6).max(30).regex(/^[+0-9 ().-]+$/),
    message: z.string().trim().max(500).optional(),
    consent: z.literal(true),
    website: z.string().max(200).optional(),
  })
  .strict();
export type ContactRequestInput = z.infer<typeof contactRequestInput>;

export type StoredContactQuote = { created_at: string; expires_at: string; cases: WebQuoteCase[] };

export type ContactDeps = {
  loadConfig: () => Promise<WebQuoteConfig | null>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  loadQuote: (id: string) => Promise<StoredContactQuote | null>;
  sendEmail: (m: { to: string; subject: string; html: string; replyTo: string; idempotencyKey: string }) => Promise<{ ok: boolean; id?: string | undefined; status: number; error?: string | undefined }>;
  now: () => Date;
};

const unavailable = () => err("service_unavailable", "Demande momentanément indisponible.");

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const TIER: Record<WebQuoteCase["tier"], string> = { entree: "Entrée de gamme", milieu: "Milieu de gamme", haut: "Haut de gamme" };
const SEASON: Record<WebQuoteCase["season"], string> = { ete: "Été", quatre_saisons: "4 saisons" };
const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " € TTC";
const parisDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** Corps déterministe : dépend uniquement du devis stocké et de la saisie. */
export function buildContactEmail(input: ContactRequestInput, offer: WebQuoteCase, quote: StoredContactQuote) {
  const label = CONTACT_RECIPIENTS[input.site].label;
  const row = (k: string, v: string | null | undefined) =>
    v ? `<tr><td style="padding:4px 12px 4px 0;color:#555;">${esc(k)}</td><td style="padding:4px 0;"><b>${esc(v)}</b></td></tr>` : "";
  const dims = [offer.size, [offer.loadIndex, offer.speedIndex].filter(Boolean).join("")].filter(Boolean).join(" ");
  const services = offer.includedServices.map((s) => s.label).join(", ");
  const hasMount = offer.includedServices.some((s) => s.code === "montage");
  const totalLabel = hasMount ? "Total TTC monté" : "Total TTC";
  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1a1a1a;background:#ffffff;">
<h2 style="margin:0 0 12px 0;">Demande de contact pneus — site web</h2>
<p>Garage choisi par le client : <b>${esc(label)}</b>. Demande à confirmer par le garage : aucun rendez-vous réservé, aucun paiement, aucune commande fournisseur.</p>
<h3>Offre affichée au client</h3>
<table>${row("Gamme", TIER[offer.tier])}${row("Saison", SEASON[offer.season])}${row("Marque", offer.brand)}${row("Modèle", offer.model)}${row("Dimension", dims)}${row("Quantité", String(offer.quantity))}${row("Total TTC monté", offer.totalTtcCents != null ? euros(offer.totalTtcCents) : null)}${row("Prestations incluses", services)}${row("Compatibilité", offer.compatibilityMessage)}</table>
<p style="color:#555;">Tarif observé le ${esc(parisDate(quote.created_at))} (heure de Paris), sous réserve de disponibilité et de confirmation par le garage. Devis ${esc(input.quoteId)}.</p>
<h3>Client</h3>
<table>${row("Nom", input.name)}${row("E-mail", input.email)}${row("Téléphone", input.phone)}</table>
${input.message ? `<p><b>Message :</b><br/>${esc(input.message).replace(/\n/g, "<br/>")}</p>` : ""}
<p style="color:#555;font-size:12px;">Référence demande : ${esc(input.requestId)}. Répondre à cet e-mail écrit directement au client.</p>
</body></html>`;
  const subject = `Demande pneus site web — ${TIER[offer.tier]} ${SEASON[offer.season]} — ${input.name}`.slice(0, 180);
  return { subject, html };
}

export async function handleContactOptions(req: Request, deps: Pick<ContactDeps, "loadConfig">): Promise<Response> {
  const origin = req.headers.get("origin");
  let allowed: string[] | null = null;
  try {
    allowed = (await deps.loadConfig())?.allowed_origins ?? null;
  } catch {
    allowed = null;
  }
  return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: corsHeaders(origin, allowed) });
}

export async function handleContactPost(req: Request, deps: ContactDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    return json(503, unavailable());
  }
  const cors = corsHeaders(origin, cfg?.allowed_origins ?? null);
  if (!cfg?.enabled) return json(503, unavailable(), cors);
  if (!originAllowed(origin, cfg.allowed_origins)) return json(403, err("origin_not_allowed", "Origine non autorisée."), cors);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors);
  const text = await readBounded(req, CONTACT_MAX_BODY_BYTES);
  if (text == null) return json(413, err("payload_too_large", "Requête trop volumineuse."), cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, err("invalid_json", "JSON invalide."), cors);
  }
  const parsed = contactRequestInput.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
    return json(400, { ...err("invalid_request", "Champs invalides."), fields }, cors);
  }
  const input = parsed.data;
  const now = deps.now();

  // Pot de miel : réponse neutre, rien envoyé (pas de « sent » mensonger : status distinct).
  if (input.website && input.website.trim() !== "") {
    console.info("[tyres-contact] dropped_bot");
    return json(202, { requestId: input.requestId, status: "received" }, cors);
  }

  try {
    const ipHash = await sha(`${now.toISOString().slice(0, 10)}|${clientIp(req)}`);
    const ipOk = await deps.quotaHit(`contact-ip:${ipHash}`, 3600, CONTACT_QUOTA_IP_PER_HOUR);
    const globalOk = ipOk ? await deps.quotaHit("contact-global", 3600, CONTACT_QUOTA_GLOBAL_PER_HOUR) : false;
    if (!ipOk || !globalOk) return json(429, err("rate_limited", "Trop de demandes, réessayez plus tard."), cors, { "Retry-After": "3600" });
  } catch {
    return json(503, unavailable(), cors);
  }

  let quote: StoredContactQuote | null;
  try {
    quote = await deps.loadQuote(input.quoteId);
  } catch {
    return json(503, unavailable(), cors);
  }
  if (!quote || new Date(quote.expires_at).getTime() < now.getTime())
    return json(409, err("quote_expired", "Devis expiré : relancez une recherche."), cors);
  const offer = quote.cases.find((c) => c.tier === input.tier && c.season === input.season);
  if (!offer || offer.status !== "available" || offer.totalTtcCents == null)
    return json(422, err("offer_unavailable", "Cette proposition n'est pas disponible dans le devis."), cors);

  const mail = buildContactEmail(input, offer, quote);
  let r: Awaited<ReturnType<ContactDeps["sendEmail"]>>;
  try {
    r = await deps.sendEmail({
      to: CONTACT_RECIPIENTS[input.site].to,
      ...mail,
      replyTo: input.email,
      idempotencyKey: `tyres-contact-${input.requestId}`,
    });
  } catch {
    console.warn("[tyres-contact] send_exception");
    return json(502, err("email_failed", "Envoi impossible, réessayez."), cors);
  }
  if (r.ok && r.id) {
    console.info(`[tyres-contact] sent site=${input.site}`);
    return json(200, { requestId: input.requestId, status: "sent", garage: input.site }, cors);
  }
  console.warn(`[tyres-contact] send_failed status=${r.status}`);
  if (r.status === 409)
    return json(409, err("request_conflict", "Cette demande a déjà été envoyée avec un contenu différent."), cors);
  if (r.status === 429) return json(503, err("email_busy", "Envoi momentanément impossible, réessayez."), cors, { "Retry-After": "60" });
  return json(502, err("email_failed", "Envoi impossible, réessayez."), cors);
}

export async function realContactDeps(): Promise<ContactDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendEmail } = await import("./email.server");
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  return {
    loadConfig: async () => {
      const { data, error } = await db
        .from("tire_web_quote_settings")
        .select("web_supplier, site_id, enabled, allowed_origins, quota_ip_per_10min, quota_global_per_hour")
        .maybeSingle();
      if (error) throw new Error("config");
      return (data ?? null) as WebQuoteConfig | null;
    },
    quotaHit: async (bucket, windowSeconds, limit) => {
      const { data, error } = await db.rpc("tire_web_quota_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
      if (error) throw new Error("quota");
      return data === true;
    },
    loadQuote: async (id) => {
      const { data, error } = await db.from("tire_web_quotes").select("created_at, expires_at, cases").eq("id", id).maybeSingle();
      if (error) throw new Error("quote");
      return (data ?? null) as StoredContactQuote | null;
    },
    // FROM_DEFAULT (garagecastillon.fr, domaine vérifié) pour les deux garages : notification interne.
    sendEmail: (m) => sendEmail(m),
    now: () => new Date(),
  };
}
