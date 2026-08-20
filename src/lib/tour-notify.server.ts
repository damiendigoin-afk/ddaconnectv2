import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { brandedEmail, emailButton, sendEmailWithAttachments } from "./email.server";

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
}): Promise<TourNotifyResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin;

  const { data: insp } = await sb
    .from("vehicle_inspections")
    .select(
      "id, site_id, status, mileage, started_at, finished_at, completed_at, duration_seconds, completed_by_name, vehicle_id, vehicle:vehicles(id, plate, brand, model), repair_order:repair_orders(id, or_number, client:clients(first_name, last_name))",
    )
    .eq("id", args.inspectionId)
    .single();
  if (!insp) return { ok: false, error: "Tour introuvable", recipients: [], photoCount: 0 };
  if (s((insp as Row)["status"]) !== "completed") {
    return { ok: false, error: "Le tour n'est pas terminé", recipients: [], photoCount: 0 };
  }

  const siteId = s((insp as Row)["site_id"]) || null;
  let recipientsQuery = sb
    .from("tour_notification_recipients")
    .select("email, site_id")
    .eq("active", true);
  if (siteId) recipientsQuery = recipientsQuery.or(`site_id.eq.${siteId},site_id.is.null`);
  else recipientsQuery = recipientsQuery.is("site_id", null);
  const { data: recRows } = await recipientsQuery;
  const recipients = Array.from(
    new Set(((recRows ?? []) as Row[]).map((r) => s(r["email"]).trim().toLowerCase()).filter(Boolean)),
  );

  const { data: logRow } = await sb
    .from("tour_notifications")
    .insert({ inspection_id: args.inspectionId, recipients, status: "pending" })
    .select("id")
    .single();
  const logId = logRow?.id as string | undefined;

  const fail = async (error: string): Promise<TourNotifyResult> => {
    if (logId) {
      await sb
        .from("tour_notifications")
        .update({ status: "failed", error_message: error.slice(0, 500) })
        .eq("id", logId);
    }
    return { ok: false, error, recipients, photoCount: 0 };
  };

  if (!recipients.length) return await fail("Aucun destinataire Front Office configuré");

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

  let pdfBase64 = "";
  let photoCount = 0;
  try {
    const built = await buildTourPdf({
      sb,
      insp: insp as Row,
      points: (points ?? []) as Row[],
      observations: (obs ?? []) as Row[],
      media: (media ?? []) as Row[],
      plate,
      clientName,
    });
    pdfBase64 = built.base64;
    photoCount = built.photoCount;
  } catch (e) {
    console.error("[tour-notify] génération PDF impossible", e);
  }

  const origin = args.origin.replace(/\/$/, "");
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
  const attachments = pdfBase64
    ? [{ filename: `tour-${plate.replace(/[^A-Za-z0-9-]/g, "")}.pdf`, content: pdfBase64 }]
    : [];

  const results = await Promise.all(
    recipients.map((to) =>
      sendEmailWithAttachments({
        to,
        subject,
        html,
        attachments,
        idempotencyKey: `tour-fo-${args.inspectionId}-${to}-${Date.now()}`,
      }),
    ),
  );
  const failed = results.filter((r) => !r.ok);

  if (logId) {
    await sb
      .from("tour_notifications")
      .update({
        status: failed.length ? (failed.length === results.length ? "failed" : "partial") : "sent",
        error_message: failed.length ? (failed[0]?.error ?? "Erreur inconnue").slice(0, 500) : null,
        photo_count: photoCount,
        sent_at: new Date().toISOString(),
      })
      .eq("id", logId);
  }

  if (failed.length === results.length) {
    return { ok: false, error: failed[0]?.error ?? "Envoi impossible", recipients, photoCount };
  }
  return { ok: true, recipients, photoCount };
}

type AnyClient = { storage: { from: (b: string) => { createSignedUrl: (p: string, e: number) => Promise<{ data: { signedUrl: string } | null }> } } };

async function buildTourPdf(args: {
  sb: unknown;
  insp: Row;
  points: Row[];
  observations: Row[];
  media: Row[];
  plate: string;
  clientName: string;
}): Promise<{ base64: string; photoCount: number }> {
  const sb = args.sb as AnyClient;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595, 842];
  const margin = 40;
  let page = pdf.addPage(A4);
  let y = A4[1] - margin;

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

  const base64 = await pdf.saveAsBase64();
  return { base64, photoCount };
}