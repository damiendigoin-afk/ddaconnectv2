import { createClient } from "@supabase/supabase-js";

import { brandedEmail, emailButton, sendEmail } from "./email.server";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serverClient() {
  return createClient(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const euro = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;

export async function sendExpertiseReportEmail(args: {
  expertiseId: string;
  to: string;
  message?: string;
  origin: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const db = serverClient();
  const { data: exp, error } = await db
    .from("vehicle_expertises")
    .select("*")
    .eq("id", args.expertiseId)
    .single();
  if (error || !exp) return { ok: false, error: "Expertise introuvable" };

  const [{ data: damages }, { data: photos }] = await Promise.all([
    db.from("expertise_damages").select("*").eq("expertise_id", exp.id).order("damage_number"),
    db.from("expertise_photos").select("*").eq("expertise_id", exp.id).order("sequence"),
  ]);

  const signed = new Map<string, string>();
  for (const p of photos ?? []) {
    const path = (p.report_path as string) ?? (p.storage_path as string);
    const { data } = await db.storage.from("dda-media").createSignedUrl(path, 60 * 60 * 24 * 30);
    if (data?.signedUrl) signed.set(p.id as string, data.signedUrl);
  }

  const total = (damages ?? []).reduce((s, d) => s + (Number(d.estimated_cost) || 0), 0);
  const pending = (damages ?? []).filter((d) => d.cost_pending || d.estimated_cost == null).length;

  const vehicleLine = [exp.brand, exp.model, exp.version].filter(Boolean).join(" ");
  const shareUrl = `${args.origin.replace(/\/$/, "")}/expertise-partage/${exp.share_token}`;

  const infoRows = [
    ["Immatriculation", exp.plate],
    ["Véhicule", vehicleLine],
    ["VIN", exp.vin],
    ["1re immatriculation", exp.first_registration],
    ["Kilométrage", exp.mileage != null ? `${Number(exp.mileage).toLocaleString("fr-FR")} km` : ""],
    ["Nombre de clés", exp.keys_count],
    ["Carte grise", exp.registration_doc === "presente" ? "Présente" : exp.registration_doc === "absente" ? "Absente" : "Non vérifiée"],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;font-size:13px;color:#71717a;">${esc(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${esc(v)}</td></tr>`,
    )
    .join("");

  const damageBlocks = (damages ?? [])
    .map((d) => {
      const url = d.photo_id ? signed.get(d.photo_id as string) : undefined;
      const cost =
        d.cost_pending || d.estimated_cost == null ? "À chiffrer" : euro(Number(d.estimated_cost));
      return `<table role="presentation" width="100%" style="margin:12px 0;border:1px solid #e4e4e7;border-radius:10px;">
        <tr><td style="padding:12px;">
          <div style="font-weight:800;font-size:15px;">Dommage n°${esc(d.damage_number)} — ${esc(d.vehicle_zone ?? "")}</div>
          <div style="font-size:13px;color:#3f3f46;padding-top:2px;">${esc(d.damage_type ?? "")}</div>
          ${d.comment ? `<div style="font-size:14px;color:#3f3f46;padding-top:6px;">${esc(d.comment)}</div>` : ""}
          ${url ? `<img src="${url}" alt="Dommage ${esc(d.damage_number)}" width="520" style="width:100%;max-width:520px;border-radius:8px;margin-top:10px;" />` : ""}
          <div style="font-size:14px;padding-top:8px;"><strong>Estimation :</strong> ${esc(cost)}</div>
        </td></tr>
      </table>`;
    })
    .join("");

  const gallery = (photos ?? [])
    .filter((p) => signed.get(p.id as string))
    .slice(0, 14)
    .map(
      (p) =>
        `<td style="padding:4px;width:50%;"><img src="${signed.get(p.id as string)}" alt="${esc(p.label ?? "Photo")}" width="260" style="width:100%;border-radius:8px;" /><div style="font-size:11px;color:#71717a;padding-top:2px;">${esc(p.label ?? "")}</div></td>`,
    )
    .reduce<string[][]>((rows, cell, i) => {
      if (i % 2 === 0) rows.push([cell]);
      else rows[rows.length - 1]!.push(cell);
      return rows;
    }, [])
    .map((cells) => `<tr>${cells.join("")}</tr>`)
    .join("");

  const inner = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 4px 0;">Rapport d'expertise véhicule</h1>
    <p style="font-size:14px;color:#3f3f46;margin:0 0 20px 0;">${esc(vehicleLine || "Véhicule")} — ${esc(exp.plate ?? "")}</p>
    ${args.message ? `<div style="background:#fafafa;border-left:4px solid #FFCC00;padding:12px 14px;font-size:14px;margin-bottom:20px;">${esc(args.message)}</div>` : ""}
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:20px;">${infoRows}</table>
    ${exp.general_comment ? `<p style="font-size:14px;color:#3f3f46;">${esc(exp.general_comment)}</p>` : ""}
    <h2 style="font-size:16px;font-weight:800;margin:24px 0 4px 0;">Dommages constatés (${(damages ?? []).length})</h2>
    ${damageBlocks || `<p style="font-size:14px;color:#3f3f46;">Aucun dommage constaté lors de l'expertise.</p>`}
    <table role="presentation" width="100%" style="margin:16px 0;background:#1a1a1a;border-radius:10px;">
      <tr><td style="padding:16px;color:#ffffff;font-size:15px;font-weight:700;">
        Estimation totale des remises en état : <span style="color:#FFCC00;">${esc(euro(total))}</span>
        ${pending ? `<div style="font-size:12px;color:#d4d4d8;font-weight:400;padding-top:4px;">${pending} poste(s) restant à chiffrer.</div>` : ""}
      </td></tr>
    </table>
    <h2 style="font-size:16px;font-weight:800;margin:24px 0 4px 0;">Photos du véhicule</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;">${gallery}</table>
    <p style="text-align:center;padding:24px 0 8px 0;">${emailButton("Voir le rapport en ligne", shareUrl)}</p>
    <p style="font-size:12px;color:#71717a;">Estimation indicative établie à partir des constats photographiques, hors démontage et sans valeur contractuelle.</p>
  `;

  const res = await sendEmail({
    to: args.to,
    subject: `Rapport d'expertise — ${vehicleLine || "véhicule"} ${exp.plate ?? ""}`.trim(),
    html: brandedEmail(inner, { preview: "Votre rapport d'expertise véhicule" }),
  });

  await db.from("email_logs").insert({
    recipient: args.to,
    subject: `Rapport d'expertise ${exp.plate ?? ""}`,
    kind: "rapport_expertise",
    status: res.ok ? "sent" : "error",
    provider_id: res.id ?? null,
    error_message: res.ok ? null : (res.error ?? null),
  });

  if (res.ok) {
    await db
      .from("vehicle_expertises")
      .update({
        status: "sent",
        last_sent_at: new Date().toISOString(),
        last_sent_to: args.to,
      })
      .eq("id", exp.id);
  }

  return { ok: res.ok, error: res.error ?? "", id: res.id ?? "" };
}