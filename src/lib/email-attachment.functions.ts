import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Récupère le fichier réel d'une pièce jointe e-mail :
 * 1) fichier déjà archivé (dda-media) ; 2) sinon téléchargement Gmail à la demande
 * via le message d'origine (email_receipts.gmail_message_id), puis archivage.
 */
export const fetchEmailAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attachmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Contrôle d'accès : la ligne doit être lisible par l'utilisateur (RLS).
    const { data: att } = await context.supabase
      .from("email_attachments")
      .select("id, email_id, filename, mime_type, storage_path, gmail_attachment_id")
      .eq("id", data.attachmentId)
      .maybeSingle();
    if (!att) return { ok: false as const, reason: "introuvable", message: "Pièce jointe introuvable ou non autorisée." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const toB64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

    if (att.storage_path) {
      const dl = await supabaseAdmin.storage.from("dda-media").download(att.storage_path);
      if (dl.data) return { ok: true as const, filename: att.filename, mime: att.mime_type ?? dl.data.type ?? "application/pdf", base64: toB64(new Uint8Array(await dl.data.arrayBuffer())) };
    }

    const { data: receipts } = await supabaseAdmin
      .from("email_receipts")
      .select("account_id, gmail_message_id")
      .eq("email_id", att.email_id)
      .not("gmail_message_id", "is", null)
      .not("account_id", "is", null);
    const { getValidAccessToken, getMessage, getAttachmentBytes } = await import("@/lib/gmail-oauth.server");
    const { pickGmailPart } = await import("@/lib/supplier-mail-filter");
    let lastErr = "Aucun message Gmail d'origine enregistré pour ce mail.";
    for (const r of receipts ?? []) {
      try {
        const { data: tok } = await supabaseAdmin
          .from("email_oauth_tokens")
          .select("access_token, refresh_token, expires_at, scope")
          .eq("account_id", r.account_id!)
          .maybeSingle();
        if (!tok?.access_token) { lastErr = "Boîte Gmail d'origine non connectée."; continue; }
        const { accessToken, refreshed, newTokens } = await getValidAccessToken({ ...tok, access_token: tok.access_token });
        if (refreshed && newTokens?.access_token) {
          await supabaseAdmin.from("email_oauth_tokens").update({ access_token: newTokens.access_token, expires_at: newTokens.expires_at ?? null, updated_at: new Date().toISOString() }).eq("account_id", r.account_id!);
        }
        const msg = await getMessage(accessToken, r.gmail_message_id!);
        if (!msg) { lastErr = "Message introuvable dans Gmail (supprimé ?)."; continue; }
        const part = pickGmailPart(msg.payload, att.filename, att.gmail_attachment_id);
        if (!part?.body?.attachmentId) { lastErr = "Pièce jointe absente du message Gmail."; continue; }
        const bytes = await getAttachmentBytes(accessToken, r.gmail_message_id!, part.body.attachmentId);
        const mime = att.mime_type ?? part.mimeType ?? "application/octet-stream";
        const safe = att.filename.replace(/[^\w.\-]+/g, "_").slice(-120);
        const path = `emails/${att.id}/${safe}`;
        const up = await supabaseAdmin.storage.from("dda-media").upload(path, bytes, { contentType: mime, upsert: true });
        if (!up.error) {
          await supabaseAdmin.from("email_attachments").update({ storage_path: path, gmail_attachment_id: part.body.attachmentId }).eq("id", att.id);
        }
        return { ok: true as const, filename: att.filename, mime, base64: toB64(bytes) };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return { ok: false as const, reason: "non_archive", message: `Fichier non archivé — ouvrir le mail. (${lastErr})` };
  });
