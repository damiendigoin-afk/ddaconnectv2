import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, CheckCircle2, Send } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { analyzeReturnBatchFn } from "@/lib/bodyshop-ai.functions";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { BUCKET, compressImage } from "@/lib/photo";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { listSuppliers, partsEmailFor } from "@/lib/suppliers";
import { refPrefill } from "@/lib/refbase";
import { deadlineFrom, getReturn, refreshReturnCredit, RETURN_STATUSES, returnStatusLabel, returnStatusTone } from "@/lib/returns";

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

type BatchAnalysis = {
  plate?: string | null;
  or_number?: string | null;
  supplier_name?: string | null;
  bl_number?: string | null;
  bl_date?: string | null;
  lines?: { reference?: string | null; label?: string | null; quantity?: number | null; unit_price?: number | null }[];
  expected_amount?: number | null;
};

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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDraft = row.status === "brouillon";

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["return", returnId] });
    void qc.invalidateQueries({ queryKey: ["returns"] });
  };

  const supplier = suppliers.data?.find((s) => s.id === row.supplier_id);

  async function setStatus(status: string) {
    await supabase.from("part_returns").update({ status }).eq("id", returnId);
    reload();
  }

  async function rescan(shots: BurstShot[]) {
    setCameraOpen(false);
    if (!shots.length) return;
    setBusy(true);
    setMsg("Analyse en cours…");
    try {
      const newPaths: string[] = [];
      for (const shot of shots) {
        const path = `magasin/${returnId}/${crypto.randomUUID()}.jpg`;
        await supabase.storage.from(BUCKET).upload(path, shot.blob, { contentType: "image/jpeg" });
        newPaths.push(path);
      }

      const res = await analyzeReturnBatchFn({
        data: { images: shots.map((s) => ({ dataUrl: s.dataUrl, filename: `${s.key}.jpg` })) },
      });

      const updates: Record<string, unknown> = { photos: [...(row.photos ?? []), ...newPaths] };
      const prevAnalysis = (row.analysis as Record<string, unknown> | null) ?? {};

      if (res.ok) {
        const a = JSON.parse(res.json) as BatchAnalysis;
        updates['analysis'] = { ...prevAnalysis, ...a };

        if (a.plate && !row.plate) {
          let plateValue = a.plate;
          try {
            const pf = await refPrefill(a.plate);
            if (pf?.fields['plate']) plateValue = pf.fields['plate'];
          } catch {
            // conservé tel quel si le référentiel ne répond pas
          }
          updates['plate'] = normalizePlate(plateValue);
        }
        if (a.or_number && !row.or_number) updates['or_number'] = a.or_number;
        if (a.supplier_name && !row.supplier_id) {
          const needle = a.supplier_name.toLowerCase();
          const found = (suppliers.data ?? []).find(
            (s) => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()),
          );
          if (found) updates['supplier_id'] = found.id;
        }
        if (a.expected_amount && !row.expected_amount) updates['expected_amount'] = a.expected_amount;

        if (a.lines?.length) {
          const existingRefs = new Set(row.lines.map((l) => (l.reference || l.label || "").toLowerCase()));
          for (const l of a.lines) {
            const key = (l.reference || l.label || "").toLowerCase();
            if (!key || existingRefs.has(key)) continue;
            await supabase.from("part_return_lines").insert({
              return_id: returnId,
              label: l.label || l.reference || "Pièce",
              reference: l.reference || null,
              quantity: l.quantity || 1,
              unit_price: l.unit_price || null,
              item_type: "piece",
            });
            existingRefs.add(key);
          }
        }
        setMsg("Nouvelles informations fusionnées avec le brouillon.");
      } else {
        setMsg(res.error || "Analyse impossible, photos conservées.");
      }

      await supabase.from("part_returns").update(updates as never).eq("id", returnId);
      reload();
    } catch {
      setMsg("Analyse impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function validateDraft() {
    if (!row.supplier_id) {
      setMsg("Choisis un fournisseur avant de valider.");
      return;
    }
    setBusy(true);
    try {
      await supabase
        .from("part_returns")
        .update({ status: "demande_creee", deadline_date: deadlineFrom(supplier?.max_return_days) })
        .eq("id", returnId);

      const to = await partsEmailFor(supplier?.id, supplier);
      if (to) {
        const res = await sendModuleEmailFn({
          data: {
            to,
            subject: `Préavis de retour ${row.reference}`,
            body: `Bonjour,\n\nNous souhaitons retourner ${row.lines.length > 1 ? "les pièces suivantes" : "la pièce suivante"} :\n${row.lines
              .map((l) => `- ${l.reference || "—"} — ${l.label || "—"} × ${Number(l.quantity)}`)
              .join("\n")}\n${row.plate ? `- Véhicule : ${formatPlate(row.plate)}\n` : ""}${row.or_number ? `- N° OR : ${row.or_number}\n` : ""}\nMerci de nous confirmer l'accord de retour et la procédure à suivre.\n\nRéférence interne : ${row.reference}\n\nCordialement,`,
            kind: "preavis_retour",
          },
        });
        if (res.ok) await supabase.from("part_returns").update({ notice_sent_at: new Date().toISOString() }).eq("id", returnId);
      }
      setMsg("Retour validé, préavis envoyé au fournisseur.");
      reload();
    } catch {
      setMsg("Validation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function ship() {
    await supabase
      .from("part_returns")
      .update({ status: "expedie", carrier: carrier || null, tracking_number: tracking || null, shipment_note: note || null, shipped_at: new Date().toISOString() })
      .eq("id", returnId);
    const to = await partsEmailFor(supplier?.id, supplier);
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
    const to = await partsEmailFor(supplier?.id, supplier);
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
      {cameraOpen ? (
        <BurstCamera
          steps={[]}
          title="Compléter le brouillon"
          onFinish={(shots) => void rescan(shots)}
          onCancel={() => setCameraOpen(false)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={returnStatusTone(row.status)}>{returnStatusLabel(row.status)}</Badge>
        {row.plate ? <span className="plate-badge text-base">{formatPlate(row.plate)}</span> : null}
        {row.deadline_date ? <span className="text-xs text-muted-foreground">Limite {new Date(row.deadline_date).toLocaleDateString("fr-FR")}</span> : null}
      </div>
      {msg ? <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

      {isDraft ? (
        <Section title="Brouillon">
          <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <p className="text-xs text-amber-900">
              Ce retour est incomplet. Complète-le en scannant de nouvelles photos, puis valide-le pour déclencher le préavis fournisseur.
            </p>
            <button
              onClick={() => setCameraOpen(true)}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
            >
              <Camera className="h-5 w-5" /> Scan / Photo
            </button>
            <Select
              label="Fournisseur"
              value={row.supplier_id ?? ""}
              onChange={(v) => void supabase.from("part_returns").update({ supplier_id: v || null }).eq("id", returnId).then(reload)}
              options={(suppliers.data ?? []).map((s) => ({ key: s.id, label: s.name }))}
            />
            <button
              onClick={() => void validateDraft()}
              disabled={busy || !row.lines.length}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-brand py-3 text-sm font-extrabold uppercase text-brand disabled:opacity-40"
            >
              <CheckCircle2 className="h-5 w-5" /> Valider le retour
            </button>
            {!row.lines.length ? <p className="text-xs text-amber-900">Ajoute au moins une pièce avant de valider.</p> : null}
          </div>
        </Section>
      ) : null}

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
          {!row.lines.length ? <p className="text-sm text-muted-foreground">Aucune ligne pour l'instant.</p> : null}
        </ul>
      </Section>

      {!isDraft ? (
        <Section title="Statut">
          <Select label="Changer le statut" value={row.status} onChange={(v) => void setStatus(v)} options={RETURN_STATUSES.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
        </Section>
      ) : null}

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
