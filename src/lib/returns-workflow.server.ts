/**
 * Workflow serveur des retours fournisseurs : e-mails, lien sécurisé fournisseur,
 * réponses externes, relances et escalades automatiques.
 */
import { sendReturnMail } from "./returns-mail.server";

type Row = Record<string, unknown>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function s(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logEvent(returnId: string, kind: string, detail: string, payload?: Row) {
  const db = await admin();
  await db.from("return_events").insert({
    return_id: returnId,
    kind,
    detail,
    payload: (payload as never) ?? null,
    actor_name: "Système",
  });
}

/** Adresse fournisseur la plus pertinente pour les retours PR. */
async function recipientFor(supplierId: string | null): Promise<{ email: string; name: string; supplier: Row | null }> {
  if (!supplierId) return { email: "", name: "", supplier: null };
  const db = await admin();
  const { data: supplier } = await db.from("suppliers").select("*").eq("id", supplierId).maybeSingle();
  const { data: contacts } = await db
    .from("supplier_contacts")
    .select("*")
    .eq("supplier_id", supplierId)
    .eq("active", true);
  const best = (contacts ?? [])
    .filter((c: Row) => s(c["email"]) && ["retour_pr", "magasin_pr"].includes(s(c["service"])))
    .sort((a: Row, b: Row) => {
      if (s(a["service"]) !== s(b["service"])) return s(a["service"]) === "retour_pr" ? -1 : 1;
      return Number(b["is_primary"]) - Number(a["is_primary"]);
    })[0];
  const email = s(best?.["email"]) || s(supplier?.["returns_email"]) || s(supplier?.["email"]);
  return { email, name: s(supplier?.["name"]), supplier: (supplier as Row) ?? null };
}

async function ensureToken(row: Row): Promise<string> {
  if (s(row["share_token"]) && row["share_enabled"] !== false) return s(row["share_token"]);
  const token = newToken();
  const db = await admin();
  await db.from("part_returns").update({ share_token: token, share_enabled: true }).eq("id", s(row["id"]));
  return token;
}

export type ReturnMailKind = "accord" | "expedition" | "reception" | "relance" | "escalade";

export async function runReturnMail(input: { returnId: string; kind: ReturnMailKind; to?: string | undefined; extra?: string | undefined }) {
  const db = await admin();
  const { data: row } = await db
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .eq("id", input.returnId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Dossier de retour introuvable.", to: "" };

  const r = row as Row;
  const target = await recipientFor(s(r["supplier_id"]) || null);
  const to =
    input.kind === "escalade"
      ? input.to || s(target.supplier?.["escalation_email"]) || target.email
      : input.to || target.email;
  if (!to) {
    return { ok: false, error: "Aucune adresse e-mail fournisseur (fiche fournisseur → contact Retour PR).", to: "" };
  }

  const token = await ensureToken(r);
  const lines = ((r["lines"] as Row[]) ?? []).map((l) => ({
    reference: s(l["reference"]) || null,
    label: s(l["label"]) || null,
    quantity: n(l["quantity"]) || 1,
    unitPrice: l["unit_price"] == null ? null : n(l["unit_price"]),
  }));

  const res = await sendReturnMail({
    kind: input.kind,
    to,
    reference: s(r["reference"]),
    supplierName: target.name || null,
    plate: s(r["plate"]) || null,
    orNumber: s(r["or_number"]) || null,
    blNumber: s(r["bl_number"]) || null,
    invoiceNumber: s(r["invoice_number"]) || null,
    documentDate: s(r["document_date"]) || null,
    lines,
    amount: n(r["expected_amount"]) + n(r["deposit_amount"]) || null,
    reason: s(r["reason"]) || null,
    handover: s(r["handover_mode"]) || null,
    extra: input.extra ?? null,
    shareToken: token,
  });

  if (!res.ok) {
    await logEvent(input.returnId, "email_erreur", `Échec envoi (${input.kind}) vers ${to} : ${res.error}`);
    return { ok: false, error: res.error || "Envoi impossible.", to };
  }

  const now = new Date().toISOString();
  const patch: Row = {};
  if (input.kind === "accord") {
    patch["accord_requested_at"] = now;
    patch["accord_status"] = "en_attente";
    patch["status"] = "accord_attendu";
  } else if (input.kind === "expedition") {
    patch["shipment_mail_sent_at"] = now;
  } else if (input.kind === "reception") {
    patch["reception_requested_at"] = now;
    patch["status"] = "reception_a_confirmer";
  } else if (input.kind === "relance") {
    patch["last_reminder_at"] = now;
    patch["reminder_count"] = n(r["reminder_count"]) + 1;
  } else if (input.kind === "escalade") {
    patch["escalated_at"] = now;
    patch["status"] = "escalade";
  }
  await db.from("part_returns").update(patch as never).eq("id", input.returnId);
  await logEvent(input.returnId, "email", `E-mail « ${input.kind} » envoyé à ${to}`, { subject: res.subject });
  return { ok: true, error: "", to };
}

/* ------------------------------------------------------------------ */
/* Portail fournisseur                                                 */
/* ------------------------------------------------------------------ */

export async function getSharedReturn(token: string) {
  const db = await admin();
  const { data } = await db
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .eq("share_token", token)
    .eq("share_enabled", true)
    .maybeSingle();
  if (!data) return { ok: false as const, error: "Lien invalide ou expiré." };
  const r = data as Row;
  const supplier = s(r["supplier_id"]) ? await recipientFor(s(r["supplier_id"])) : null;
  return {
    ok: true as const,
    error: "",
    data: {
      reference: s(r["reference"]),
      status: s(r["status"]),
      supplierName: supplier?.name ?? "",
      plate: s(r["plate"]),
      orNumber: s(r["or_number"]),
      blNumber: s(r["bl_number"]),
      invoiceNumber: s(r["invoice_number"]),
      documentDate: s(r["document_date"]),
      reason: s(r["reason"]),
      expectedAmount: n(r["expected_amount"]) + n(r["deposit_amount"]),
      accordStatus: s(r["accord_status"]),
      receptionStatus: s(r["reception_status"]),
      shippedAt: s(r["shipped_at"]) || s(r["handover_at"]),
      lines: ((r["lines"] as Row[]) ?? []).map((l) => ({
        reference: s(l["reference"]),
        label: s(l["label"]),
        quantity: n(l["quantity"]),
        unitPrice: l["unit_price"] == null ? null : n(l["unit_price"]),
      })),
    },
  };
}

const ACCORD_ANSWERS = ["accepte", "refuse", "info", "non_concerne", "en_cours"];

export async function submitSharedAnswer(input: {
  token: string;
  answer: string;
  comment?: string | undefined;
  creditNumber?: string | undefined;
  creditAmount?: number | undefined;
  file?: { name: string; mimeType: string; dataBase64: string } | undefined;
}) {
  const db = await admin();
  const { data } = await db
    .from("part_returns")
    .select("*")
    .eq("share_token", input.token)
    .eq("share_enabled", true)
    .maybeSingle();
  if (!data) return { ok: false, error: "Lien invalide ou expiré." };
  const r = data as Row;
  const id = s(r["id"]);
  const now = new Date().toISOString();
  const patch: Row = {};

  if (ACCORD_ANSWERS.includes(input.answer)) {
    patch["accord_status"] = input.answer;
    patch["accord_response_at"] = now;
    patch["accord_comment"] = input.comment ?? null;
    patch["status"] =
      input.answer === "accepte"
        ? "accord_accepte"
        : input.answer === "refuse"
          ? "refus"
          : input.answer === "info"
            ? "info_requise"
            : input.answer === "non_concerne"
              ? "non_concerne"
              : "accord_attendu";
    if (input.answer === "refuse") patch["accord_refusal_reason"] = input.comment ?? null;
  } else {
    patch["reception_status"] = input.answer;
    patch["reception_confirmed_at"] = now;
    patch["reception_comment"] = input.comment ?? null;
    patch["status"] =
      input.answer === "recu"
        ? "reception_confirmee"
        : input.answer === "non_recu"
          ? "non_recu"
          : input.answer === "partiel"
            ? "reception_partielle"
            : input.answer === "probleme"
              ? "litige"
              : "non_concerne";
  }

  if (input.creditAmount != null && input.creditAmount > 0) {
    patch["credited_amount"] = n(r["credited_amount"]) + input.creditAmount;
    patch["status"] =
      n(patch["credited_amount"]) >= n(r["expected_amount"]) + n(r["deposit_amount"]) ? "totalement_avoire" : "partiellement_avoire";
  }

  await db.from("part_returns").update(patch as never).eq("id", id);

  if (input.file) {
    const bytes = Uint8Array.from(atob(input.file.dataBase64), (c) => c.charCodeAt(0));
    const path = `returns/${id}/fournisseur-${Date.now()}-${input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await db.storage.from("dda-media").upload(path, bytes, { contentType: input.file.mimeType, upsert: false });
    if (!up.error) {
      await db.from("return_documents").insert({
        return_id: id,
        kind: input.creditNumber ? "avoir" : "reponse_fournisseur",
        storage_path: path,
        filename: input.file.name,
        mime_type: input.file.mimeType,
        source: "fournisseur",
        uploaded_by_name: "Fournisseur",
        meta: (input.creditNumber ? { credit_number: input.creditNumber } : null) as never,
      });
    }
  }

  await logEvent(id, "reponse_fournisseur", `Réponse fournisseur : ${input.answer}${input.comment ? ` — ${input.comment}` : ""}`, {
    credit_number: input.creditNumber ?? null,
    credit_amount: input.creditAmount ?? null,
  });
  return { ok: true, error: "" };
}

/* ------------------------------------------------------------------ */
/* Relances automatiques                                               */
/* ------------------------------------------------------------------ */

const WAITING = ["accord_demande", "accord_attendu", "expedie", "reception_a_confirmer", "avoir_attendu", "partiellement_avoire"];

export async function runReturnFollowups() {
  const db = await admin();
  const { data } = await db.from("part_returns").select("*").in("status", WAITING).limit(500);
  const rows = (data ?? []) as Row[];
  let reminders = 0;
  let escalations = 0;
  const errors: string[] = [];

  const suppliers = new Map<string, Row>();
  for (const r of rows) {
    const sid = s(r["supplier_id"]);
    if (!sid || suppliers.has(sid)) continue;
    const { data: sup } = await db.from("suppliers").select("*").eq("id", sid).maybeSingle();
    if (sup) suppliers.set(sid, sup as Row);
  }

  for (const r of rows) {
    const sup = suppliers.get(s(r["supplier_id"]));
    if (sup && sup["reminders_enabled"] === false) continue;
    const first = n(sup?.["first_reminder_days"]) || 7;
    const interval = n(sup?.["reminder_interval_days"]) || 7;
    const max = n(sup?.["max_reminders"]) || 3;
    const count = n(r["reminder_count"]);
    const base = s(r["last_reminder_at"]) || s(r["accord_requested_at"]) || s(r["handover_at"]) || s(r["shipped_at"]) || s(r["updated_at"]);
    if (!base) continue;
    const days = Math.floor((Date.now() - new Date(base).getTime()) / 86400000);
    const due = count === 0 ? days >= first : days >= interval;
    if (!due) continue;

    if (count >= max) {
      if (s(r["escalated_at"])) continue;
      const res = await runReturnMail({ returnId: s(r["id"]), kind: "escalade" });
      if (res.ok) escalations += 1;
      else errors.push(`${s(r["reference"])}: ${res.error}`);
      continue;
    }
    const res = await runReturnMail({ returnId: s(r["id"]), kind: "relance" });
    if (res.ok) reminders += 1;
    else errors.push(`${s(r["reference"])}: ${res.error}`);
  }

  return { ok: true, reminders, escalations, scanned: rows.length, errors: errors.slice(0, 10) };
}
