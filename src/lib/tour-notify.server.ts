import { brandedEmail, emailButton, sendEmailWithAttachments } from "./email.server";
import {
  acceptedProviderSend,
  aggregateFrontOfficeResults,
  
  emailLogOutcome,
  frontOfficeIdempotencyKey,
  normalizeFrontOfficeRecipients,
} from "./tour-notify-core";

type Row = Record<string, unknown>;

function s(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


export type TourNotifyResult = {
  ok: boolean;
  error?: string;
  recipients: string[];
  photoCount: number;
};

/**
 * Notification automatique du Front Office à la clôture d'un Tour Véhicule.
 * Le PDF complet (tous les points + toutes les photos) est généré côté serveur
 * et joint à l'e-mail.
 */
export async function notifyTourCompleted(args: {
  inspectionId: string;
  origin: string;
  /** Clôture automatique : ne jamais renvoyer deux fois la même notification. */
  skipIfAlreadySent?: boolean;
  /** Une relance manuelle est une nouvelle tentative explicitement traçable. */
  mode?: "automatic" | "manual";
  /** Tentative déjà ouverte par l'appelant (clôture) : on la réutilise. */
  logId?: string | null;
}): Promise<TourNotifyResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin;

  if (args.skipIfAlreadySent) {
    const { data: already } = await sb
      .from("tour_notifications")
      .select("recipients, photo_count")
      .eq("inspection_id", args.inspectionId)
      .in("status", ["sent", "partial"])
      .limit(1);
    const hit = ((already ?? []) as Row[])[0];
    if (hit) {
      if (args.logId) {
        await sb
          .from("tour_notifications")
          .update({ status: "skipped", error_message: "Notification déjà envoyée pour ce tour" })
          .eq("id", args.logId);
      }
      return {
        ok: true,
        recipients: (hit["recipients"] as string[]) ?? [],
        photoCount: Number(hit["photo_count"] ?? 0),
      };
    }
  }

  // Journalisation systématique : la tentative est tracée avant toute lecture,
  // pour qu'un échec précoce reste visible dans l'historique du tour.
  let logId = args.logId ?? undefined;
  if (!logId) {
    const { data: logRow, error: logError } = await sb
      .from("tour_notifications")
      .insert({ inspection_id: args.inspectionId, recipients: [], status: "pending" })
      .select("id")
      .single();
    if (logError) console.error("[tour-notify] journalisation impossible", logError);
    logId = (logRow?.id as string | undefined) ?? undefined;
  }

  const logFail = async (
    error: string,
    recipients: string[] = [],
    status = "failed",
  ): Promise<TourNotifyResult> => {
    console.error("[tour-notify]", error);
    if (logId) {
      await sb
        .from("tour_notifications")
        .update({ status, error_message: error.slice(0, 500), recipients })
        .eq("id", logId);
    }
    return { ok: false, error, recipients, photoCount: 0 };
  };

  const { data: insp, error: inspError } = await sb
    .from("vehicle_inspections")
    .select(
      "id, site_id, status, mileage, started_at, finished_at, completed_at, duration_seconds, completed_by_name, vehicle_id, vehicle:vehicles(id, plate, brand, model), repair_order:repair_orders(id, or_number, client:clients(first_name, last_name))",
    )
    .eq("id", args.inspectionId)
    .single();
  if (inspError || !insp) {
    return await logFail(
      inspError ? `Lecture du tour impossible : ${inspError.message}` : "Tour introuvable",
    );
  }
  if (s((insp as Row)["status"]) !== "completed") {
    return await logFail("Le tour n'est pas terminé");
  }

  const siteId = s((insp as Row)["site_id"]) || null;
  let recipientsQuery = sb
    .from("tour_notification_recipients")
    .select("email, site_id")
    .eq("active", true);
  // Tour rattaché à un établissement : destinataires du site + destinataires globaux.
  // Tour sans établissement : on retombe sur l'ensemble des destinataires actifs.
  if (siteId) recipientsQuery = recipientsQuery.or(`site_id.eq.${siteId},site_id.is.null`);
  const { data: recRows, error: recError } = await recipientsQuery;
  if (recError) console.error("[tour-notify] lecture des destinataires impossible", recError);
  if (recError) {
    return await logFail(`Lecture des destinataires impossible : ${recError.message}`);
  }
  const recipients = normalizeFrontOfficeRecipients((recRows ?? []) as Row[]);
  if (logId && recipients.length) {
    await sb.from("tour_notifications").update({ recipients }).eq("id", logId);
  }
  if (!recipients.length) {
    // Diagnostic explicite : on nomme l'établissement concerné et l'écran de
    // paramétrage, plutôt que de rediriger l'e-mail vers une autre adresse.
    let siteName = "";
    if (siteId) {
      const { data: site } = await sb.from("sites").select("name").eq("id", siteId).single();
      siteName = s((site as Row | null)?.["name"]);
    }
    return await logFail(
      `Aucun destinataire Front Office configuré pour ${siteName ? `l'établissement ${siteName}` : "ce tour (aucun établissement rattaché)"} — à paramétrer dans Paramétrage > Notifications Front Office`,
      [],
      "no_recipients",
    );
  }

  const [{ data: points }, { data: obs }, { data: media }] = await Promise.all([
    sb
      .from("inspection_points")
      .select("id, zone_label, point_label, status, measure_value, measure_unit, comment")
      .eq("inspection_id", args.inspectionId)
      .order("zone_index"),
    sb
      .from("observations")
      .select("id, category, element, status, measure_value, measure_unit, comment")
      .eq("inspection_id", args.inspectionId)
      .order("created_at"),
    sb
      .from("media")
      .select("id, storage_path, thumb_path, inspection_point_id, observation_id, label")
      .eq("inspection_id", args.inspectionId)
      .order("created_at"),
  ]);

  const v = (insp as Row)["vehicle"] as Row | null;
  const or = (insp as Row)["repair_order"] as Row | null;
  const client = (or?.["client"] ?? null) as Row | null;
  const plate = s(v?.["plate"]) || "Sans plaque";
  const clientName =
    [s(client?.["first_name"]), s(client?.["last_name"])].filter(Boolean).join(" ") || "Client inconnu";

  // Expertise associée éventuelle (même véhicule).
  let expertiseId = "";
  const vehicleId = s((insp as Row)["vehicle_id"]) || s(v?.["id"]);
  if (vehicleId) {
    const { data: exp } = await sb
      .from("vehicle_expertises")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false })
      .limit(1);
    expertiseId = s(((exp ?? []) as Row[])[0]?.["id"]);
  }

  const { publicOrigin } = await import("./public-url.server");
  const origin = publicOrigin(args.origin);

  const logEmailFailureForRecipients = async (error: string) => {
    await Promise.all(
      recipients.map((recipient) =>
        sb.from("email_logs").insert({
          inspection_id: args.inspectionId,
          recipient,
          subject: `Tour de véhicule terminé – ${plate} – ${clientName}`,
          kind: "rapport_front_office",
          status: "failed",
          error_message: error.slice(0, 500),
        }),
      ),
    );
  };

  // Le PDF est un plus, pas une condition : si sa génération échoue, le Front
  // Office est tout de même averti de la clôture (l'échec est journalisé).
  let pdfBase64: string | null = null;
  let photoCount = 0;
  let pdfError = "";
  try {
    const { buildTourPdf, tourLogoUrl } = await import("./tour-pdf.server");
    const built = await buildTourPdf({
      sb,
      insp: insp as Row,
      points: (points ?? []) as Row[],
      observations: (obs ?? []) as Row[],
      media: (media ?? []) as Row[],
      plate,
      clientName,
      inspectionId: args.inspectionId,
      logoUrl: tourLogoUrl(origin),
    });
    pdfBase64 = built.base64;
    photoCount = built.photoCount;
  } catch (e) {
    pdfError = `Génération du PDF impossible : ${e instanceof Error ? e.message : String(e)}`;
    console.error("[tour-notify]", pdfError);
    await logEmailFailureForRecipients(pdfError);
  }

  const tourLink = `${origin}/tour/${args.inspectionId}/rapport`;
  const expLink = expertiseId ? `${origin}/expertise/${expertiseId}` : "";

  const subject = `Tour de véhicule terminé – ${plate} – ${clientName}`;
  const inner = `
    <p style="font-size:16px;margin:0 0 20px 0;">
      Le Tour Véhicule de <strong>${esc(plate)}</strong> – ${esc(clientName)} est terminé.
    </p>
    <p style="font-size:15px;margin:0 0 8px 0;font-weight:700;">Accès au dossier :</p>
    <ul style="font-size:15px;line-height:1.7;margin:0 0 20px 0;padding-left:20px;">
      <li><a href="${tourLink}">Tour Véhicule</a></li>
      ${expLink ? `<li><a href="${expLink}">Expertise associée</a></li>` : ""}
    </ul>
    <div style="text-align:center;padding:8px 0 16px 0;">${emailButton("Ouvrir le Tour Véhicule", tourLink)}</div>
    <p style="font-size:13px;color:#71717a;">${
      pdfBase64
        ? `Rapport PDF complet joint à cet e-mail (${photoCount} photo(s)).`
        : "Le rapport PDF n'a pas pu être généré : le détail complet reste consultable en ligne via le lien ci-dessus."
    }</p>`;

  const html = brandedEmail(inner, { preview: `Tour terminé – ${plate}` });
  const attachments = pdfBase64
    ? [{ filename: `tour-${plate.replace(/[^A-Za-z0-9-]/g, "")}.pdf`, content: pdfBase64 }]
    : [];
  const mode = args.mode ?? (args.skipIfAlreadySent ? "automatic" : "manual");
  const attemptId = mode === "manual" ? crypto.randomUUID() : undefined;

  const results = await Promise.all(
    recipients.map(async (to) => {
      const { data: emailLog, error: emailLogError } = await sb
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
      if (emailLogError || !emailLog?.id) {
        return {
          ok: false,
          status: 0,
          error: `Journalisation email impossible : ${emailLogError?.message ?? "identifiant absent"}`,
        };
      }

      let result;
      try {
        result = await sendEmailWithAttachments({
          to,
          subject,
          html,
          attachments,
          idempotencyKey: frontOfficeIdempotencyKey({
            inspectionId: args.inspectionId,
            recipient: to,
            mode,
            ...(attemptId ? { attemptId } : {}),
          }),
        });
      } catch (e) {
        result = {
          ok: false,
          status: 0,
          error: `Erreur fournisseur : ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      const outcome = emailLogOutcome(result);
      await sb.from("email_logs").update(outcome).eq("id", emailLog.id);
      return acceptedProviderSend(result)
        ? result
        : { ...result, ok: false, error: outcome.error_message ?? "Envoi non confirmé" };
    }),
  );
  const status = aggregateFrontOfficeResults(results);
  const failed = results.filter((r) => !acceptedProviderSend(r));

  if (logId) {
    await sb
      .from("tour_notifications")
      .update({
        status,
        error_message: failed.length
          ? (failed[0]?.error ?? "Erreur inconnue").slice(0, 500)
          : pdfError
            ? pdfError.slice(0, 500)
            : null,
        photo_count: photoCount,
        sent_at: status === "failed" ? null : new Date().toISOString(),
      })
      .eq("id", logId);
  }

  if (failed.length === results.length) {
    return { ok: false, error: failed[0]?.error ?? "Envoi impossible", recipients, photoCount };
  }
  return { ok: true, recipients, photoCount };
}
