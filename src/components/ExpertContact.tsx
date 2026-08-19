import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, FileScan, Loader2, Send, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { logEvent, type CaseRow } from "@/lib/bodyshop";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { BUCKET, compressImage } from "@/lib/photo";
import { expertEmailFor, listExperts, listFirms } from "@/lib/referentials";

type Shot = { path: string; label: string };

/** Bouton unique « Communiquer avec l'expert » : scan de l'OR, photos, e-mail avec galerie. */
export function ExpertContact({ row, onSent }: { row: CaseRow; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const orRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [message, setMessage] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const firms = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const experts = useQuery({ queryKey: ["experts"], queryFn: listExperts });
  const expert = experts.data?.find((e) => e.id === row.expert_id) ?? null;
  const firm = firms.data?.find((f) => f.id === row.expert_firm_id) ?? null;
  const suggested = expertEmailFor("default", expert, firm);
  const recipient = (to || suggested).trim();

  async function add(file: File, label: string) {
    const blob = await compressImage(file, 1800, 0.85);
    const path = `carrosserie/${row.id}/expert-${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) {
      setMsg("Envoi de la photo impossible, réessaie.");
      return;
    }
    setShots((s) => [...s, { path, label }]);
  }

  async function send() {
    if (!recipient.includes("@")) {
      setMsg("Renseigne une adresse e-mail d'expert.");
      return;
    }
    if (!shots.length && !message.trim()) {
      setMsg("Ajoute au moins une photo ou un message.");
      return;
    }
    setBusy(true);
    const links = await Promise.all(
      shots.map(async (s, i) => {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(s.path, 60 * 60 * 24 * 14);
        return { label: `${s.label} ${i + 1}`, url: data?.signedUrl ?? "" };
      }),
    );
    const subject = `Dossier ${row.plate ?? ""}${row.or_number ? ` · OR ${row.or_number}` : ""}${
      row.claim_number ? ` · sinistre ${row.claim_number}` : ""
    }`.trim();
    const body = [
      "Bonjour,",
      "",
      `Véhicule : ${row.plate ?? "—"} ${row.vehicle_label ?? ""}`.trim(),
      `OR : ${row.or_number ?? "—"} · Sinistre : ${row.claim_number ?? "—"}`,
      "",
      message.trim() || "Veuillez trouver ci-joint les éléments du dossier.",
      "",
      "Cordialement,",
    ].join("\n");

    const res = await sendModuleEmailFn({
      data: { to: recipient, subject, body, kind: "communication_expert", links: links.filter((l) => l.url) },
    });

    await supabase.from("bodyshop_communications").insert({
      case_id: row.id,
      channel: "email",
      template_key: "communication_expert",
      recipient,
      subject,
      body,
      status: res.ok ? "envoye" : "erreur",
      sent_at: res.ok ? new Date().toISOString() : null,
      error_message: res.ok ? null : res.error || "Envoi impossible",
    });
    await logEvent({
      caseId: row.id,
      kind: "expert",
      label: res.ok ? "Communication expert envoyée" : "Échec envoi expert",
      detail: `${recipient} · ${shots.length} photo(s)`,
    });

    setBusy(false);
    setMsg(res.ok ? "Envoyé à l'expert." : res.error || "Envoi impossible.");
    if (res.ok) {
      setShots([]);
      setMessage("");
      onSent?.();
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
      >
        <Send className="h-4 w-4" /> Communiquer avec l'expert
      </button>

      {open ? (
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <input
            value={to || suggested}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Adresse e-mail de l'expert"
            placeholder="expert@cabinet.fr"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => orRef.current?.click()} className="flex items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-3 text-xs font-bold uppercase">
              <FileScan className="h-4 w-4" /> Scanner l'OR
            </button>
            <button onClick={() => photoRef.current?.click()} className="flex items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-3 text-xs font-bold uppercase">
              <Camera className="h-4 w-4" /> Photo dégât
            </button>
          </div>
          <input
            ref={orRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f, "OR");
              e.target.value = "";
            }}
          />
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f, "Photo");
              e.target.value = "";
            }}
          />

          {shots.length ? (
            <ul className="flex flex-wrap gap-2">
              {shots.map((s, i) => (
                <li key={s.path} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-bold">
                  {s.label} {i + 1}
                  <button aria-label="Retirer la photo" onClick={() => setShots((v) => v.filter((x) => x.path !== s.path))}>
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            aria-label="Message à l'expert"
            placeholder="Message à l'expert…"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />

          <button
            onClick={() => void send()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer
          </button>
          {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}