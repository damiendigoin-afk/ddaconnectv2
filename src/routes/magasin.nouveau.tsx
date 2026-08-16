import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Area, Field, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { analyzeScanFn } from "@/lib/bodyshop-ai.functions";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { blobToDataUrl, BUCKET, compressImage } from "@/lib/photo";
import { normalizePlate } from "@/lib/plate";
import { listSuppliers } from "@/lib/referentials";
import { deadlineFrom } from "@/lib/returns";

export const Route = createFileRoute("/magasin/nouveau")({
  head: () => ({
    meta: [
      { title: "Nouvelle demande de retour — DDA Connect" },
      { name: "description", content: "Créer une demande de retour de pièce en photographiant l'étiquette et prévenir le fournisseur." },
      { property: "og:title", content: "Nouvelle demande de retour — DDA Connect" },
      { property: "og:description", content: "Demande de retour pièce en moins d'une minute depuis l'atelier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewReturn,
});

const REASONS = [
  { key: "erreur_reference", label: "Erreur de référence" },
  { key: "piece_non_utilisee", label: "Pièce non utilisée" },
  { key: "piece_endommagee", label: "Pièce endommagée" },
  { key: "consigne", label: "Consigne / échange standard" },
  { key: "surplus", label: "Commande en surplus" },
  { key: "autre", label: "Autre" },
] as const;

function NewReturn() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [plate, setPlate] = useState("");
  const [orNumber, setOrNumber] = useState("");
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("piece_non_utilisee");
  const [comments, setComments] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  async function onPhoto(file: File) {
    setBusy(true);
    setMsg("");
    try {
      const blob = await compressImage(file, 1800, 0.85);
      const path = `magasin/${crypto.randomUUID()}.jpg`;
      await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      setPhotoPath(path);
      const res = await analyzeScanFn({ data: { dataUrl: await blobToDataUrl(blob), filename: file.name } });
      if (res.ok) {
        const p = JSON.parse(res.json) as { part_reference?: string | null; part_label?: string | null; plate?: string | null; or_number?: string | null };
        if (p.part_reference) setReference(p.part_reference);
        if (p.part_label) setLabel(p.part_label);
        if (p.plate) setPlate(p.plate);
        if (p.or_number) setOrNumber(p.or_number);
        setMsg("Photo analysée, vérifie les champs.");
      } else setMsg(res.error);
    } catch {
      setMsg("Photo impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!supplierId) {
      setMsg("Choisis un fournisseur.");
      return;
    }
    if (!label.trim() && !reference.trim()) {
      setMsg("Indique au moins une référence ou un libellé.");
      return;
    }
    setBusy(true);
    try {
      const supplier = suppliers.data?.find((s) => s.id === supplierId);
      const qty = Number(quantity.replace(",", ".")) || 1;
      const unit = price ? Number(price.replace(",", ".")) : null;
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("part_returns")
        .insert({
          supplier_id: supplierId,
          plate: plate ? normalizePlate(plate) : null,
          or_number: orNumber || null,
          status: "a_preparer",
          deadline_date: deadlineFrom(supplier?.max_return_days),
          expected_amount: unit ? unit * qty : null,
          comments: comments || null,
          created_by: auth.user?.id ?? null,
          created_by_name: auth.user?.email ?? null,
        })
        .select()
        .single();
      if (error || !data) throw error;
      const ret = data as { id: string; reference: string };

      await supabase.from("part_return_lines").insert({
        return_id: ret.id,
        label: label || reference,
        reference: reference || null,
        quantity: qty,
        unit_price: unit,
        item_type: reason === "consigne" ? "consigne" : "piece",
        photo_path: photoPath,
        notes: REASONS.find((r) => r.key === reason)?.label ?? reason,
      });

      const to = supplier?.returns_email || supplier?.email || "";
      if (notify && to) {
        const res = await sendModuleEmailFn({
          data: {
            to,
            subject: `Préavis de retour ${ret.reference}`,
            body: `Bonjour,\n\nNous souhaitons retourner la pièce suivante :\n- Référence : ${reference || "—"}\n- Désignation : ${label || "—"}\n- Quantité : ${qty}\n- Motif : ${REASONS.find((r) => r.key === reason)?.label}\n${plate ? `- Véhicule : ${normalizePlate(plate)}\n` : ""}${orNumber ? `- N° OR : ${orNumber}\n` : ""}\nMerci de nous confirmer l'accord de retour et la procédure à suiver.\n\nRéférence interne : ${ret.reference}\n\nCordialement,`,
            kind: "preavis_retour",
          },
        });
        if (res.ok) await supabase.from("part_returns").update({ notice_sent_at: new Date().toISOString() }).eq("id", ret.id);
      }

      await navigate({ to: "/magasin/$returnId", params: { returnId: ret.id } });
    } catch {
      setMsg("Création impossible.");
      setBusy(false);
    }
  }

  return (
    <AppShell title="Demande de retour" subtitle="Magasin" back={{ to: "/magasin" }}>
      <div className="space-y-3">
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-4 text-brand-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
          <span className="text-base font-extrabold uppercase tracking-wide">Photographier la pièce / l'étiquette</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPhoto(f);
            e.target.value = "";
          }}
        />
        {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

        <Select label="Fournisseur" value={supplierId} onChange={setSupplierId} options={(suppliers.data ?? []).map((s) => ({ key: s.id, label: s.name }))} />
        <Field label="Référence pièce" value={reference} onChange={setReference} />
        <Field label="Désignation" value={label} onChange={setLabel} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Quantité" value={quantity} onChange={setQuantity} />
          <Field label="Prix unitaire (€)" value={price} onChange={setPrice} />
        </div>
        <Select label="Motif" value={reason} onChange={setReason} options={REASONS.map((r) => ({ key: r.key, label: r.label }))} allowEmpty={false} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Immatriculation" value={plate} onChange={setPlate} />
          <Field label="N° OR" value={orNumber} onChange={setOrNumber} />
        </div>
        <Area label="Commentaires" value={comments} onChange={setComments} />

        <button onClick={() => setNotify(!notify)} className={`w-full rounded-lg border-2 py-3 text-sm font-bold ${notify ? "border-brand bg-brand/10" : "border-border"}`}>
          {notify ? "Préavis fournisseur activé" : "Préavis fournisseur désactivé"}
        </button>

        <button onClick={() => void submit()} disabled={busy} className="w-full rounded-xl bg-brand py-4 text-lg font-extrabold uppercase text-brand-foreground disabled:opacity-50">
          Créer la demande
        </button>
      </div>
    </AppShell>
  );
}
