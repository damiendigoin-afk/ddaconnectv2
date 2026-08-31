import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";

import { brandedEmail, emailButton, sendEmailWithAttachments } from "./email.server";
import {
  acceptedProviderSend,
  aggregateFrontOfficeResults,
  assertUsablePdf,
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

const STATUS_FR: Record<string, string> = {
  ok: "OK",
  watch: "A surveiller",
  defect: "Defaut",
  unset: "Non renseigne",
};

/** Nettoie le texte pour la police PDF standard (WinAnsi). */
function pdfText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
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
      return {
        ok: true,
        recipients: (hit["recipients"] as string[]) ?? [],
        photoCount: Number(hit["photo_count"] ?? 0),
      };
    }
  }

  // Journalisation systématique : la tentative est tracée avant toute lecture,
  // pour qu'un échec précoce reste visible dans l'historique du tour.
  const { data: logRow, error: logError } = await sb
    .from("tour_notifications")
    .insert({ inspection_id: args.inspectionId, recipients: [], status: "pending" })
    .select("id")
    .single();
  if (logError) console.error("[tour-notify] journalisation impossible", logError);
  const logId = logRow?.id as string | undefined;

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
    return await logFail("Aucun destinataire Front Office configuré", [], "no_recipients");
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
  const logoUrl = new URL(ddaRenaultLogo.url, `${origin}/`).toString();

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

  let pdfBase64: string;
  let photoCount: number;
  try {
    const built = await buildTourPdf({
      sb,
      insp: insp as Row,
      points: (points ?? []) as Row[],
      observations: (obs ?? []) as Row[],
      media: (media ?? []) as Row[],
      plate,
      clientName,
      inspectionId: args.inspectionId,
      logoUrl,
    });
    assertUsablePdf(built.base64);
    pdfBase64 = built.base64;
    photoCount = built.photoCount;
  } catch (e) {
    const error = `Génération du PDF impossible : ${e instanceof Error ? e.message : String(e)}`;
    await logEmailFailureForRecipients(error);
    return await logFail(error, recipients);
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
    <p style="font-size:13px;color:#71717a;">Rapport PDF complet joint à cet e-mail (${photoCount} photo(s)).</p>`;

  const html = brandedEmail(inner, { preview: `Tour terminé – ${plate}` });
  const attachments = [{ filename: `tour-${plate.replace(/[^A-Za-z0-9-]/g, "")}.pdf`, content: pdfBase64 }];
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
        error_message: failed.length ? (failed[0]?.error ?? "Erreur inconnue").slice(0, 500) : null,
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

type AnyClient = { storage: { from: (b: string) => { createSignedUrl: (p: string, e: number) => Promise<{ data: { signedUrl: string } | null }> } } };

export async function buildTourPdf(args: {
  sb: unknown;
  insp: Row;
  points: Row[];
  observations: Row[];
  media: Row[];
  plate: string;
  clientName: string;
  inspectionId: string;
  logoUrl: string;
}): Promise<{ base64: string; photoCount: number }> {
  const sb = args.sb as AnyClient;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595, 842];
  const margin = 40;
  let page = pdf.addPage(A4);
  let y = A4[1] - margin;

  const logoResponse = await fetch(args.logoUrl);
  if (!logoResponse.ok) throw new Error(`Logo officiel inaccessible (${logoResponse.status})`);
  const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());
  const logo = await pdf.embedJpg(logoBytes);
  const logoScale = Math.min(210 / logo.width, 58 / logo.height);
  page.drawImage(logo, {
    x: margin,
    y: y - logo.height * logoScale,
    width: logo.width * logoScale,
    height: logo.height * logoScale,
  });
  y -= logo.height * logoScale + 14;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - margin;
  };
  const need = (h: number) => {
    if (y - h < margin) newPage();
  };
  const line = (text: string, size = 10, isBold = false) => {
    need(size + 6);
    page.drawText(pdfText(text).slice(0, 120), {
      x: margin,
      y: y - size,
      size,
      font: isBold ? bold : font,
      color: rgb(0, 0, 0),
    });
    y -= size + 6;
  };

  line("RAPPORT DE TOUR VEHICULE", 16, true);
  line(`${args.plate} — ${args.clientName}`, 12, true);
  line(`Reference du tour : ${args.inspectionId}`, 7);
  const finished = s(args.insp["finished_at"]) || s(args.insp["completed_at"]);
  if (finished) line(`Termine le ${new Date(finished).toLocaleString("fr-FR")}`);
  if (args.insp["mileage"]) line(`Kilometrage : ${Number(args.insp["mileage"]).toLocaleString("fr-FR")} km`);
  if (args.insp["completed_by_name"]) line(`Operateur : ${s(args.insp["completed_by_name"])}`);
  const dur = args.insp["duration_seconds"];
  if (typeof dur === "number") line(`Duree : ${Math.floor(dur / 60)} min ${dur % 60} s`);
  y -= 8;

  if (args.points.length) {
    line("POINTS CONTROLES", 12, true);
    for (const p of args.points) {
      const extra = [
        p["measure_value"] ? `${s(p["measure_value"])} ${s(p["measure_unit"])}`.trim() : "",
        s(p["comment"]),
      ]
        .filter(Boolean)
        .join(" — ");
      line(
        `${s(p["zone_label"])} / ${s(p["point_label"])} : ${STATUS_FR[s(p["status"])] ?? s(p["status"])}${
          extra ? ` — ${extra}` : ""
        }`,
        9,
      );
    }
    y -= 8;
  }

  if (args.observations.length) {
    line("OBSERVATIONS", 12, true);
    for (const o of args.observations) {
      line(
        `${s(o["category"])} / ${s(o["element"])} : ${STATUS_FR[s(o["status"])] ?? s(o["status"])}${
          s(o["comment"]) ? ` — ${s(o["comment"])}` : ""
        }`,
        9,
      );
    }
    y -= 8;
  }

  const labelFor = (m: Row): string => {
    const p = args.points.find((x) => x["id"] === m["inspection_point_id"]);
    if (p) return `${s(p["zone_label"])} / ${s(p["point_label"])}`;
    const o = args.observations.find((x) => x["id"] === m["observation_id"]);
    if (o) return `${s(o["category"])} / ${s(o["element"])}`;
    return s(m["label"]) || "Autre photo du tour";
  };

  const linked = args.media.filter((m) => m["inspection_point_id"] || m["observation_id"]);
  const others = args.media.filter((m) => !m["inspection_point_id"] && !m["observation_id"]);

  let photoCount = 0;
  const drawPhotos = async (rows: Row[], title: string) => {
    if (!rows.length) return;
    line(title, 12, true);
    const cols = 2;
    const cellW = (A4[0] - margin * 2 - 12) / cols;
    const cellH = 150;
    let col = 0;
    for (const m of rows) {
      const path = s(m["thumb_path"]) || s(m["storage_path"]);
      if (!path) continue;
      let bytes: Uint8Array | null = null;
      try {
        const { data } = await sb.storage.from("dda-media").createSignedUrl(path, 600);
        if (data?.signedUrl) {
          const res = await fetch(data.signedUrl);
          if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
        }
      } catch (e) {
        console.error("[tour-notify] photo illisible", path, e);
      }
      if (!bytes) continue;
      let img;
      try {
        img = await pdf.embedJpg(bytes);
      } catch {
        try {
          img = await pdf.embedPng(bytes);
        } catch (e) {
          console.error("[tour-notify] format photo non supporte", path, e);
          continue;
        }
      }
      if (col === 0) need(cellH + 14);
      const x = margin + col * (cellW + 12);
      const scale = Math.min(cellW / img.width, cellH / img.height);
      page.drawImage(img, {
        x,
        y: y - img.height * scale,
        width: img.width * scale,
        height: img.height * scale,
      });
      page.drawText(pdfText(labelFor(m)).slice(0, 45), {
        x,
        y: y - cellH - 10,
        size: 7,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      photoCount += 1;
      col += 1;
      if (col === cols) {
        col = 0;
        y -= cellH + 22;
      }
    }
    if (col !== 0) y -= cellH + 22;
  };

  await drawPhotos(linked, "PHOTOS DES POINTS CONTROLES");
  await drawPhotos(others, "AUTRES PHOTOS DU TOUR");

  pdf.setTitle(`Tour véhicule ${args.plate} — ${args.inspectionId}`);
  pdf.setSubject(`Compte-rendu du tour ${args.inspectionId}`);
  const base64 = await pdf.saveAsBase64();
  assertUsablePdf(base64);
  return { base64, photoCount };
}