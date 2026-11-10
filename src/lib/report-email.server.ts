import { formatMeasure } from "./measure";
import {
  authorizeReport,
  databaseFailure,
  logReportFailure,
  ReportFailure,
  type ReportActor,
} from "./report-access.server";

import { brandedEmail, emailButton, sendEmail } from "./email.server";

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

const STATUS_LABEL: Record<string, string> = {
  defect: "À remplacer / réparer",
  watch: "À surveiller",
  ok: "Conforme",
};
const STATUS_COLOR: Record<string, string> = {
  defect: "#dc2626",
  watch: "#ea580c",
  ok: "#16a34a",
};

function itemRow(item: {
  title: string;
  status: string;
  measure: string;
  comment: string;
}): string {
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
      <div style="font-weight:700;font-size:15px;">${esc(item.title)}</div>
      <div style="font-size:13px;font-weight:700;color:${STATUS_COLOR[item.status] ?? "#71717a"};">
        ${esc(STATUS_LABEL[item.status] ?? item.status)}${item.measure ? ` · ${esc(item.measure)}` : ""}
      </div>
      ${item.comment ? `<div style="font-size:14px;color:#3f3f46;padding-top:4px;">${esc(item.comment)}</div>` : ""}
    </td>
  </tr>`;
}

export async function sendTourReportEmail(args: {
  inspectionId: string;
  to: string;
  message?: string;
  origin: string;
  actor: ReportActor;
}): Promise<{ ok: boolean; error?: string; id?: string; code?: string; status?: number }> {
  let sb: Awaited<ReturnType<typeof authorizeReport>> | undefined;
  let logId: string | undefined;
  let stage = "authorization";
  try {
    sb = await authorizeReport(args.actor, args.inspectionId, "tour");
    stage = "initial-log";
    const { data: attempt, error: logError } = await sb
      .from("email_logs")
      .insert({
        inspection_id: args.inspectionId,
        recipient: args.to,
        subject: "Compte rendu de contrôle",
        kind: "rapport_client",
        status: "pending",
      })
      .select("id")
      .single();
    if (logError || !attempt) {
      if (logError) logReportFailure(stage, args.inspectionId, logError);
      throw new ReportFailure(
        "database",
        500,
        "Journalisation de l’envoi impossible. Aucun mail envoyé.",
      );
    }
    logId = attempt.id;
    stage = "inspection-load";

    const { data: insp, error } = await sb
      .from("vehicle_inspections")
      .select(
        "id, share_token, mileage, started_at, completed_at, inspection_type, vehicle:vehicles(plate, brand, model), repair_order:repair_orders(or_number, client:clients(first_name, last_name))",
      )
      .eq("id", args.inspectionId)
      .maybeSingle();
    if (error) {
      logReportFailure(stage, args.inspectionId, error);
      throw databaseFailure(error);
    }
    if (!insp) throw new ReportFailure("not_found", 404, "Tour introuvable");

    stage = "controls-load";
    const [{ data: points, error: pointsError }, { data: obs, error: obsError }] =
      await Promise.all([
        sb
          .from("inspection_points")
          .select(
            "zone_label, point_label, status, measure_value, measure_unit, comment, client_comment",
          )
          .eq("inspection_id", args.inspectionId)
          .in("status", ["watch", "defect"])
          .order("zone_index"),
        sb
          .from("observations")
          .select("category, element, status, measure_value, measure_unit, comment, client_comment")
          .eq("inspection_id", args.inspectionId)
          .order("created_at"),
      ]);

    const loadError = pointsError ?? obsError;
    if (loadError) {
      logReportFailure(stage, args.inspectionId, loadError);
      throw databaseFailure(loadError);
    }

    const items = [
      ...((points ?? []) as Row[]).map((p) => ({
        title: `${s(p["zone_label"])} — ${s(p["point_label"])}`,
        status: s(p["status"]),
        measure: formatMeasure(p["measure_value"], s(p["measure_unit"])) ?? "",
        comment: s(p["client_comment"]) || s(p["comment"]),
      })),
      ...((obs ?? []) as Row[]).map((o) => ({
        title: `${s(o["category"])} — ${s(o["element"])}`,
        status: s(o["status"]),
        measure: formatMeasure(o["measure_value"], s(o["measure_unit"])) ?? "",
        comment: s(o["client_comment"]) || s(o["comment"]),
      })),
    ];

    const v = (insp as Row)["vehicle"] as Row | null;
    const or = (insp as Row)["repair_order"] as Row | null;
    const client = (or?.["client"] ?? null) as Row | null;
    const plate = s(v?.["plate"]);
    const vehicleName = [s(v?.["brand"]), s(v?.["model"])].filter(Boolean).join(" ");
    const hello = client
      ? `Bonjour ${esc([s(client["first_name"]), s(client["last_name"])].filter(Boolean).join(" "))},`
      : "Bonjour,";
    const { publicOrigin } = await import("./public-url.server");
    const link = `${publicOrigin(args.origin)}/partage/${s((insp as Row)["share_token"])}`;
    const defects = items.filter((i) => i.status === "defect").length;
    const watches = items.filter((i) => i.status === "watch").length;

    const inner = `
    <p style="font-size:16px;margin:0 0 16px 0;">${hello}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px 0;">
      Voici le compte rendu du contrôle réalisé sur votre véhicule
      <strong>${esc(vehicleName || "—")}</strong>${plate ? ` (${esc(plate)})` : ""}${
        insp["mileage"] ? ` — ${Number(insp["mileage"]).toLocaleString("fr-FR")} km` : ""
      }.
    </p>
    ${
      args.message
        ? `<div style="background:#fff8dd;border-left:4px solid #FFCC00;padding:12px 16px;margin:0 0 20px 0;font-size:15px;line-height:1.6;">${esc(
            args.message,
          ).replace(/\n/g, "<br />")}</div>`
        : ""
    }
    <p style="font-size:15px;margin:0 0 8px 0;font-weight:700;">
      ${defects} point(s) à traiter · ${watches} point(s) à surveiller
    </p>
    ${
      items.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items
            .map(itemRow)
            .join("")}</table>`
        : `<p style="font-size:15px;color:#16a34a;font-weight:700;">Aucun défaut constaté lors de ce contrôle.</p>`
    }
    <div style="text-align:center;padding:28px 0 8px 0;">${emailButton(
      "Voir le rapport détaillé",
      link,
    )}</div>
    <p style="font-size:13px;color:#71717a;line-height:1.6;padding-bottom:16px;">
      Ce rapport reste consultable à tout moment via le lien ci-dessus.
    </p>`;

    const subject = `Compte rendu de contrôle — ${plate || vehicleName || "votre véhicule"}${
      or?.["or_number"] ? ` (OR ${s(or["or_number"])})` : ""
    }`;

    const { error: subjectError } = await sb.from("email_logs").update({ subject }).eq("id", logId);
    if (subjectError) {
      logReportFailure("subject-log", args.inspectionId, subjectError);
      throw databaseFailure(subjectError);
    }
    stage = "send";
    const res = await sendEmail({
      to: args.to,
      subject,
      html: brandedEmail(inner, { preview: `${defects} point(s) à traiter sur votre véhicule` }),
      idempotencyKey: `tour-${args.inspectionId}-${Date.now()}`,
    });
    const accepted = res.ok === true && typeof res.id === "string" && res.id.trim().length > 0;

    if (logId) {
      try {
        const { error: outcomeError } = await sb
          .from("email_logs")
          .update({
            status: accepted ? "sent" : "failed",
            provider_id: res.id ?? null,
            error_message: accepted ? null : (res.error ?? "Envoi non confirmé").slice(0, 500),
          })
          .eq("id", logId);
        if (outcomeError) logReportFailure("outcome-log", args.inspectionId, outcomeError);
      } catch (journalError) {
        logReportFailure("outcome-log", args.inspectionId, journalError);
      }
    }

    if (accepted) {
      try {
        const { error: sentError } = await sb
          .from("vehicle_inspections")
          .update({ last_sent_at: new Date().toISOString(), last_sent_to: args.to })
          .eq("id", args.inspectionId);
        if (sentError) logReportFailure("last-sent", args.inspectionId, sentError);
      } catch (sentError) {
        logReportFailure("last-sent", args.inspectionId, sentError);
      }
      return { ok: true, ...(res.id ? { id: res.id } : {}) };
    }
    logReportFailure("provider", args.inspectionId, {
      code: "send",
      status: res.status,
      message: res.error,
    });
    return {
      ok: false,
      code: "send",
      status: 502,
      error: "Envoi du compte rendu impossible. Réessayez plus tard.",
    };
  } catch (error) {
    logReportFailure(stage, args.inspectionId, error);
    const failure =
      error instanceof ReportFailure
        ? error
        : new ReportFailure(
            stage === "send" ? "send" : "database",
            stage === "send" ? 502 : 500,
            stage === "send"
              ? "Envoi du compte rendu non confirmé. Vérifiez l’historique avant de réessayer."
              : "Chargement du compte rendu impossible. Réessayez plus tard.",
          );
    if (sb && logId) {
      try {
        const { error: journalError } = await sb
          .from("email_logs")
          .update({ status: "failed", error_message: `${failure.code}: ${failure.message}` })
          .eq("id", logId);
        if (journalError) logReportFailure("failure-log", args.inspectionId, journalError);
      } catch (journalError) {
        logReportFailure("failure-log", args.inspectionId, journalError);
      }
    }
    return { ok: false, error: failure.message, code: failure.code, status: failure.status };
  }
}
