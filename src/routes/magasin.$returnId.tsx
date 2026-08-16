import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Send } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { BUCKET, compressImage } from "@/lib/photo";
import { formatPlate } from "@/lib/plate";
import { listSuppliers } from "@/lib/referentials";
import { getReturn, refreshReturnCredit, RETURN_STATUSES, returnStatusLabel, returnStatusTone } from "@/lib/returns";

export const Route = createFileRoute("/magasin/$returnId")({
  head: () => ({
    meta: [
      { title: "Retour pièce — DDA Connect" },
      { name: "description", content: "Préparation, expédition, suivi de l'avoir et relance fournisseur pour un retour de pièce." },
      { property: "og:title", content: "Retour pièce — DDA Connect" },
      { property: "og:description", content: "Suivi complet d'un retour de pièce jusqu'à l'avoir." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReturnView,
});

function ReturnView() {
  const { returnId } = Route.useParams();
  const r = useQuery({ queryKey: ["return", returnId], queryFn: () => getReturn(returnId) });
  if (!r.data) {
    return (
      <AppShell title="Retour" back={{ to: "/magasin" }}>
        <p className="text-sm text-muted-foreground">{r.isLoading ? "Chargement…" : "Retour introuvable."}</p>
      </AppShell>
    );
  }
  return <ReturnDetail row={r.data} returnId={returnId} />;
}

type ReturnRow = NonNullable<Awaited<ReturnType<typeof getReturn>>>;

function ReturnDetail({ row, returnId }: { row: ReturnRow; returnId: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["return", returnId] });
    void qc.invalidateQueries({ queryKey: ["returns"] });
  };

  const supplier = suppliers.data?.find((s) => s.id === row.supplier_id);

  async function setStatus(status: string) {
    await supabase.from("part_returns").update({ status }).eq("id", returnId);
    reload();
  }

  async function ship() {
    await supabase
      .from("part_returns")
      .update({ status: "expedie", carrier: carrier || null, tracking_number: tracking || null, shipment_note: note || null, shipped_at: new Date().toISOString() })
      .eq("id", returnId);
    const to = supplier?.returns_email || supplier?.email;
    if (to) {
      await sendModuleEmailFn({
        data: {
          to,
          subject: `Expédition du retour ${row.reference}`,
          body: `Bonjour,\n\nLe retour ${row.reference} vous a été expédié${carrier ? ` via ${carrier}` : ""}${tracking ? ` (suivi ${tracking})` : ""}.\n\nMerci d'établir l'avoir correspondant.\n\nCordialement,`,
          kind: "expedition_retour",
        },
      });
    }
    setMsg("Expédition enregistrée.");
    reload();
  }

  async function shipPhoto(file: File) {
    const blob = await compressImage(file, 1600, 0.8);
    const path = `magasin/${returnId}/exp-${crypto.randomUUID()}.jpg`;
    await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    await supabase.from("part_returns").update({ shipment_photo: path }).eq("id", returnId);
    setMsg("Photo du colis enregistrée.");
    reload();
  }

  async function remind() {
    const to = supplier?.returns_email || supplier?.email;
    if (!to) {
      setMsg("Aucune adresse fournisseur.");
      return;
    }
    const res = await sendModuleEmailFn({
      data: {
        to,
        subject: `Relance avoir — retour ${row.reference}`,
        body: `Bonjour,\n\nNous n'avons pas reçu l'avoir correspondant au retour ${row.reference}${row.shipped_at ? ` expédié le ${new Date(row.shipped_at).toLocaleDateString("fr-FR")}` : ""}.\nMontant attendu : ${Number(row.expected_amount ?? 0).toFixed(2)} €.\n\nMerci de régulariser.\n\nCordialement,`,
        kind: "relance_avoir",
      },
    });
    await supabase.from("return_reminders").insert({
      supplier_id: row.supplier_id,
      return_ids: [returnId],
      level: 1,
      recipient: to,
      subject: `Relance avoir — retour ${row.reference}`,
      body: "Relance automatique",
      status: res.ok ? "sent" : "error",
      error_message: res.ok ? null : res.error || null,
      ...(res.ok ? { sent_at: new Date().toISOString() } : {}),
    });
    setMsg(res.ok ? "Relance envoyée." : res.error || "Envoi impossible.");
  }

  return (
    <AppShell title={row.reference} subtitle={supplier?.name ?? ""} back={{ to: "/magasin" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={returnStatusTone(row.status)}>{returnStatusLabel(row.status)}</Badge>
        {row.plate ? <span className="plate-badge text-base">{formatPlate(row.plate)}</span> : null}
        {row.deadline_date ? <span className="text-xs text-muted-foreground">Limite {new Date(row.deadline_date).toLocaleDateString("fr-FR")}</span> : null}
      </div>
      {msg ? <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

      <Section title="Lignes">
        <ul className="space-y-2">
          {row.lines.map((l) => (
            <li key={l.id} className="card-surface p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{l.label}</span>
                <span>{Number(l.quantity)} × {l.unit_price ? `${Number(l.unit_price).toFixed(2)} €` : "—"}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {l.reference ?? "—"} · {l.item_type} · avoiré {Number(l.credited_quantity ?? 0)} ({Number(l.credited_amount ?? 0).toFixed(2)} €)
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Statut">
        <Select label="Changer le statut" value={row.status} onChange={(v) => void setStatus(v)} options={RETURN_STATUSES.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
      </Section>

      <Section title="Expédition">
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <Field label="Transporteur" value={carrier} onChange={setCarrier} />
          <Field label="N° de suivi" value={tracking} onChange={setTracking} />
          <Area label="Note" value={note} onChange={setNote} rows={2} />
          <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2 rounded-lg bg-secondary px-3 py-3 text-sm font-bold uppercase">
            <Camera className="h-4 w-4" /> Photo du colis
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void shipPhoto(f);
              e.target.value = "";
            }}
          />
          <button onClick={() => void ship()} className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground">
            Marquer expédié
          </button>
        </div>
      </Section>

      <Section title="Avoir">
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3 text-sm">
          <div className="flex justify-between"><span>Montant attendu</span><span className="font-bold">{Number(row.expected_amount ?? 0).toFixed(2)} €</span></div>
          <div className="flex justify-between"><span>Montant avoiré</span><span className="font-bold">{Number(row.credited_amount ?? 0).toFixed(2)} €</span></div>
          <button onClick={() => void refreshReturnCredit(returnId).then(reload)} className="w-full rounded-lg border-2 border-border py-2 text-sm font-bold">
            Recalculer
          </button>
          <button onClick={() => void remind()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground">
            <Send className="h-4 w-4" /> Relancer le fournisseur
          </button>
        </div>
      </Section>
    </AppShell>
  );
}
