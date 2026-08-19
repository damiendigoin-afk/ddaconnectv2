import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { logEvent, type CaseRow } from "@/lib/bodyshop";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { ocrRepairOrder } from "@/lib/ocr.functions";
import { BUCKET, blobToDataUrl, compressImage } from "@/lib/photo";
import { normalizePlate } from "@/lib/plate";
import { expertEmailFor, listExperts, listFirms } from "@/lib/referentials";
import { EXPERT_REASONS, fillPlaceholders, listTemplates, type ExpertReasonKey } from "@/lib/templates";

type Stage = "idle" | "camera" | "identify" | "compose";
type Shot = { path: string; label: string };

/**
 * Communication expert — parcours unique : scan de l'OR → identification automatique
 * du dossier et de l'expert → motif → photos facultatives → envoi de l'e-mail.
 * Module d'émission uniquement : les réponses reviennent par le Flux emails.
 */
export function ExpertCommunication({ row, onSent }: { row?: CaseRow | null; onSent?: () => void }) {
  const { displayName } = useAuth();
  const [stage, setStage] = useState<Stage>("idle");
  const [caseRow, setCaseRow] = useState<CaseRow | null>(row ?? null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [reason, setReason] = useState<ExpertReasonKey>("expert_passage");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [manualEmail, setManualEmail] = useState("");

  const templates = useQuery({ queryKey: ["message-templates"], queryFn: listTemplates });
  const firms = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const experts = useQuery({ queryKey: ["experts"], queryFn: listExperts });

  const active = caseRow ?? row ?? null;
  const expert = experts.data?.find((e) => e.id === active?.expert_id) ?? null;
  const firm = firms.data?.find((f) => f.id === active?.expert_firm_id) ?? null;
  const knownEmail = expertEmailFor("default", expert, firm);
  const recipient = (knownEmail || manualEmail).trim();

  function vars(c: CaseRow | null) {
    return {
      plate: c?.plate ?? "—",
      vehicle: c?.vehicle_label ?? "",
      or: c?.or_number ?? "—",
      claim: c?.claim_number ?? "—",
      customer: c?.customer_name ?? "—",
    };
  }

  function applyReason(key: ExpertReasonKey, c: CaseRow | null) {
    setReason(key);
    const tpl = templates.data?.find((t) => t.key === key);
    setSubject(fillPlaceholders(tpl?.subject ?? "Dossier {{plate}}", vars(c)));
    setMessage(fillPlaceholders(tpl?.body ?? "Bonjour,\n\n\n\nCordialement,", vars(c)));
  }

  async function upload(blob: Blob, label: string, caseId: string) {
    const jpg = await compressImage(blob, 1800, 0.85);
    const path = `carrosserie/${caseId}/expert-${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, jpg, { contentType: "image/jpeg" });
    if (error) return null;
    return { path, label } satisfies Shot;
  }

  /** Identifie le dossier à partir de la photo de l'OR (n° d'OR, puis immatriculation). */
  async function identify(orShot: BurstShot): Promise<CaseRow | null> {
    const res = await ocrRepairOrder({ data: { dataUrl: orShot.dataUrl } });
    if (!res.ok) return null;
    const parsed = JSON.parse(res.json) as {
      order?: { or_number?: string | null };
      vehicle?: { plate?: string | null };
    };
    const orNumber = (parsed.order?.or_number ?? "").trim();
    const plate = normalizePlate(parsed.vehicle?.plate ?? "");
    if (orNumber) {
      const { data } = await supabase.from("bodyshop_cases").select("*").eq("or_number", orNumber).limit(1);
      if ((data ?? []).length) return (data ?? [])[0] as CaseRow;
    }
    if (plate) {
      const { data } = await supabase
        .from("bodyshop_cases")
        .select("*")
        .neq("case_state", "dossier_clos")
        .order("created_at", { ascending: false })
        .limit(200);
      const hit = ((data ?? []) as CaseRow[]).find((c) => normalizePlate(c.plate ?? "") === plate);
      if (hit) return hit;
    }
    return null;
  }

  async function onFinish(all: BurstShot[]) {
    setStage("identify");
    setMsg("");
    let target = active;
    if (!target && all.length) {
      target = await identify(all[0]!);
      if (!target) {
        setMsg("Dossier non identifié depuis l'OR. Ouvre le dossier concerné puis relance la communication.");
        setStage("idle");
        return;
      }
      setCaseRow(target);
    }
    if (!target) {
      setStage("idle");
      return;
    }
    const uploaded: Shot[] = [];
    for (const s of all) {
      const done = await upload(s.blob, s.label, target.id);
      if (done) uploaded.push(done);
    }
    setShots(uploaded);
    applyReason(reason, target);
    setStage("compose");
  }

  async function send() {
    const target = active;
    if (!target) return;
    if (!recipient.includes("@")) {
      setMsg("Aucune adresse expert connue sur ce dossier : renseigne-la ci-dessous.");
      return;
    }
    setBusy(true);
    const links = await Promise.all(
      shots.map(async (s, i) => {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(s.path, 60 * 60 * 24 * 14);
        return { label: `${s.label} ${i + 1}`, url: data?.signedUrl ?? "" };
      }),
    );
    const reasonLabel = EXPERT_REASONS.find((r) => r.key === reason)?.label ?? "Autre";
    const res = await sendModuleEmailFn({
      data: {
        to: recipient,
        subject: subject || `Dossier ${target.plate ?? ""}`.trim(),
        body: message,
        kind: "communication_expert",
        links: links.filter((l) => l.url),
      },
    });

    await supabase.from("bodyshop_communications").insert({
      case_id: target.id,
      channel: "email",
      template_key: reason,
      recipient,
      subject: subject || `Dossier ${target.plate ?? ""}`.trim(),
      body: `${reasonLabel}\n\n${message}`,
      status: res.ok ? "envoye" : "erreur",
      sent_at: res.ok ? new Date().toISOString() : null,
      error_message: res.ok ? null : res.error || "Envoi impossible",
    });
    await logEvent({
      caseId: target.id,
      kind: "expert",
      label: res.ok ? `Communication expert — ${reasonLabel}` : "Échec envoi expert",
      detail: `${recipient} · ${shots.length} photo(s)`,
      byName: displayName ?? null,
    });

    setBusy(false);
    setMsg(res.ok ? "Envoyé à l'expert." : res.error || "Envoi impossible.");
    if (res.ok) {
      setShots([]);
      setStage("idle");
      onSent?.();
    }
  }

  if (stage === "camera") {
    return (
      <BurstCamera
        title="Communication expert"
        steps={[{ key: "or", label: "Ordre de réparation", mask: "document" }]}
        allowFree
        onCancel={() => setStage("idle")}
        onFinish={(all) => void onFinish(all)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {stage === "idle" || stage === "identify" ? (
        <button
          onClick={() => setStage("camera")}
          disabled={stage === "identify"}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {stage === "identify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {stage === "identify" ? "Identification du dossier…" : "Communiquer avec l'expert"}
        </button>
      ) : null}

      {stage === "compose" && active ? (
        <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
          <div className="rounded-lg bg-secondary px-3 py-2 text-xs">
            <div className="font-extrabold uppercase">{active.plate ?? "—"} · OR {active.or_number ?? "—"}</div>
            <div className="text-muted-foreground">
              {active.vehicle_label ?? "—"} · {active.customer_name ?? "—"}
            </div>
            <div className="text-muted-foreground">
              Expert : {expert ? [expert.first_name, expert.last_name].filter(Boolean).join(" ") : firm?.name ?? "—"}
              {knownEmail ? ` · ${knownEmail}` : ""}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {EXPERT_REASONS.map((r) => (
              <button
                key={r.key}
                onClick={() => applyReason(r.key, active)}
                className={`rounded-lg px-3 py-3 text-xs font-bold uppercase ${
                  reason === r.key ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {!knownEmail ? (
            <input
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              aria-label="Adresse e-mail de l'expert"
              placeholder="expert@cabinet.fr"
              className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
            />
          ) : null}

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Objet du message"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            aria-label="Message à l'expert"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">{shots.length} photo(s) jointe(s).</p>

          <div className="flex gap-2">
            <button
              onClick={() => setStage("camera")}
              className="rounded-lg border-2 border-border bg-card px-3 py-3 text-xs font-bold uppercase"
            >
              Photos
            </button>
            <button
              onClick={() => void send()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer à l'expert
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
    </div>
  );
}
