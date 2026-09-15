import { brandedEmail, emailButton, sendEmail } from "./email.server";
import { frontOfficeIdempotencyKey, normalizeFrontOfficeRecipients } from "./tour-notify-core";

type Row = Record<string, unknown>;

/**
 * Filet de sécurité de la notification Front Office.
 *
 * Utilisé uniquement si le service complet (`tour-notify.server`, qui génère le
 * PDF) ne peut pas être chargé ou lève une exception dans le runtime serveur.
 * Il ne crée PAS un second système : mêmes destinataires paramétrés, même
 * service d'envoi, même clé d'idempotence — donc aucun doublon possible si le
 * service complet avait déjà envoyé le message. Seule la pièce jointe manque.
 */
export async function sendTourFallbackNotice(args: {
  inspectionId: string;
  origin: string;
  logId: string | null;
  reason: string;
}): Promise<{ ok: boolean; recipients: string[]; error: string }> {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");

  const { data: insp } = await sb
    .from("vehicle_inspections")
    .select("id, site_id, status, vehicle:vehicles(plate)")
    .eq("id", args.inspectionId)
    .single();
  if (!insp) return { ok: false, recipients: [], error: "Tour introuvable" };

  const siteId = typeof (insp as Row)["site_id"] === "string" ? ((insp as Row)["site_id"] as string) : null;
  let query = sb.from("tour_notification_recipients").select("email, site_id").eq("active", true);
  if (siteId) query = query.or(`site_id.eq.${siteId},site_id.is.null`);
  const { data: recRows } = await query;
  const recipients = normalizeFrontOfficeRecipients((recRows ?? []) as Row[]);
  if (!recipients.length) {
    if (args.logId) {
      await sb
        .from("tour_notifications")
        .update({
          status: "no_recipients",
          error_message: "Aucun destinataire Front Office configuré pour cet établissement",
        })
        .eq("id", args.logId);
    }
    return { ok: false, recipients: [], error: "Aucun destinataire Front Office configuré" };
  }

  const vehicle = ((insp as Row)["vehicle"] ?? null) as Row | null;
  const plate = typeof vehicle?.["plate"] === "string" ? (vehicle["plate"] as string) : "Sans plaque";
  const link = `${args.origin.replace(/\/+$/, "")}/tour/${args.inspectionId}/rapport`;
  const subject = `Tour de véhicule terminé – ${plate}`;
  const html = brandedEmail(
    `<p style="font-size:16px;margin:0 0 20px 0;">Le Tour Véhicule de <strong>${plate}</strong> est terminé.</p>
     <div style="text-align:center;padding:8px 0 16px 0;">${emailButton("Ouvrir le compte-rendu", link)}</div>
     <p style="font-size:13px;color:#71717a;">Le rapport PDF n'a pas pu être joint : le détail complet reste consultable en ligne.</p>`,
    { preview: `Tour terminé – ${plate}` },
  );

  const outcomes = await Promise.all(
    recipients.map(async (to) => {
      const { data: log } = await sb
        .from("email_logs")
        .insert({
          inspection_id: args.inspectionId,
          recipient: to,
          subject,
          kind: "rapport_front_office",
          status: "pending",
        })
        .select("id")
        .single();
      let res;
      try {
        res = await sendEmail({
          to,
          subject,
          html,
          idempotencyKey: frontOfficeIdempotencyKey({
            inspectionId: args.inspectionId,
            recipient: to,
            mode: "automatic",
          }),
        });
      } catch (e) {
        res = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      }
      const accepted = res.ok === true && typeof res.id === "string" && res.id.trim().length > 0;
      if (log?.id) {
        await sb
          .from("email_logs")
          .update({
            status: accepted ? "sent" : "failed",
            provider_id: accepted ? (res.id ?? null) : null,
            error_message: accepted ? null : (res.error ?? "Envoi non confirmé").slice(0, 500),
          })
          .eq("id", log.id);
      }
      return accepted;
    }),
  );

  const accepted = outcomes.filter(Boolean).length;
  const status = accepted === outcomes.length ? "sent" : accepted > 0 ? "partial" : "failed";
  if (args.logId) {
    await sb
      .from("tour_notifications")
      .update({
        status,
        recipients,
        error_message: `Envoi de secours sans PDF (${args.reason})`.slice(0, 500),
      })
      .eq("id", args.logId);
  }
  return {
    ok: accepted > 0,
    recipients,
    error: accepted > 0 ? "" : "Envoi de secours refusé par le fournisseur",
  };
}
