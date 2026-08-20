import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Camera, Loader2, Save } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { Area, Field, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { analyzeReturnBatchFn } from "@/lib/bodyshop-ai.functions";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { BUCKET } from "@/lib/photo";
import { normalizePlate } from "@/lib/plate";
import { listSuppliers, partsEmailFor } from "@/lib/suppliers";
import { refPrefill } from "@/lib/refbase";
import { RETURN_TYPES, deadlineFrom } from "@/lib/returns";

export const Route = createFileRoute("/magasin/nouveau")({
  head: () => ({
    meta: [
      { title: "Nouvelle demande de retour — DDA Connect" },
      { name: "description", content: "Photographier en rafale les documents d'un retour pièce et laisser l'IA préremplir la fiche." },
      { property: "og:title", content: "Nouvelle demande de retour — DDA Connect" },
      { property: "og:description", content: "Scan libre puis fiche récapitulative éditable pour un retour de pièce." },
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

type Line = {
  reference: string;
  label: string;
  quantity: string;
  unitPrice: string;
  checked: boolean;
  annotation?: string;
  confidence?: string;
  itemType?: string;
};

type BatchAnalysis = {
  photos?: { index: number; type: string }[];
  plate?: string | null;
  or_number?: string | null;
  supplier_name?: string | null;
  client_name?: string | null;
  site_name?: string | null;
  document_kind?: string | null;
  bl_number?: string | null;
  invoice_number?: string | null;
  bl_date?: string | null;
  lines?: {
    reference?: string | null;
    label?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    amount?: number | null;
    selected?: boolean | null;
    annotation?: string | null;
    confidence?: string | null;
    item_type?: string | null;
  }[];
  expected_amount?: number | null;
  deposit_amount?: number | null;
  consigne?: string | null;
};

function NewReturn() {
  const navigate = useNavigate();
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });

  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [analyzed, setAnalyzed] = useState(false);

  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [rawAnalysis, setRawAnalysis] = useState<BatchAnalysis | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [plate, setPlate] = useState("");
  const [orNumber, setOrNumber] = useState("");
  const [blNumber, setBlNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentKind, setDocumentKind] = useState("bl");
  const [returnType, setReturnType] = useState("classique");
  const [blDate, setBlDate] = useState("");
  const [clientName, setClientName] = useState("");
  const [reason, setReason] = useState("piece_non_utilisee");
  const [comments, setComments] = useState("");
  const [lines, setLines] = useState<Line[]>([{ reference: "", label: "", quantity: "1", unitPrice: "", checked: true }]);
  const [notify, setNotify] = useState(true);

  async function runBatch(shots: BurstShot[]) {
    setCameraOpen(false);
    if (!shots.length) return;
    setBusy(true);
    setMsg("Analyse en cours…");
    try {
      const paths: string[] = [];
      for (const shot of shots) {
        const path = `magasin/${crypto.randomUUID()}.jpg`;
        await supabase.storage.from(BUCKET).upload(path, shot.blob, { contentType: "image/jpeg" });
        paths.push(path);
      }
      setPhotoPaths((p) => [...p, ...paths]);

      const res = await analyzeReturnBatchFn({
        data: { images: shots.map((s) => ({ dataUrl: s.dataUrl, filename: `${s.key}.jpg` })) },
      });
      if (res.ok) {
        const a = JSON.parse(res.json) as BatchAnalysis;
        setRawAnalysis((prev) => mergeAnalysis(prev, a));
        applyAnalysis(a);
        setAnalyzed(true);
        setMsg("Analyse terminée, vérifie la fiche ci-dessous.");
      } else {
        setMsg(res.error || "Analyse impossible, complète manuellement.");
        setAnalyzed(true);
      }

      if (plate === "" && rawAnalysisHasPlate()) {
        // resolved below in applyAnalysis via refPrefill
      }
    } catch {
      setMsg("Photo ou analyse impossible.");
    } finally {
      setBusy(false);
    }
  }

  function rawAnalysisHasPlate() {
    return Boolean(rawAnalysis?.plate);
  }

  function mergeAnalysis(prev: BatchAnalysis | null, next: BatchAnalysis): BatchAnalysis {
    if (!prev) return next;
    return {
      photos: [...(prev.photos ?? []), ...(next.photos ?? [])],
      plate: prev.plate ?? next.plate ?? null,
      or_number: prev.or_number ?? next.or_number ?? null,
      supplier_name: prev.supplier_name ?? next.supplier_name ?? null,
      client_name: prev.client_name ?? next.client_name ?? null,
      site_name: prev.site_name ?? next.site_name ?? null,
      document_kind: prev.document_kind ?? next.document_kind ?? null,
      bl_number: prev.bl_number ?? next.bl_number ?? null,
      invoice_number: prev.invoice_number ?? next.invoice_number ?? null,
      bl_date: prev.bl_date ?? next.bl_date ?? null,
      lines: (prev.lines?.length ? prev.lines : next.lines) ?? [],
      expected_amount: prev.expected_amount ?? next.expected_amount ?? null,
      deposit_amount: prev.deposit_amount ?? next.deposit_amount ?? null,
      consigne: prev.consigne ?? next.consigne ?? null,
    };
  }

  async function applyAnalysis(a: BatchAnalysis) {
    if (a.plate && !plate) {
      setPlate(a.plate);
      try {
        const pf = await refPrefill(a.plate);
        if (pf?.fields['plate']) setPlate(pf.fields['plate']);
      } catch {
        // ignore, l'utilisateur pourra corriger manuellement
      }
    }
    if (a.or_number && !orNumber) setOrNumber(a.or_number);
    if (a.bl_number && !blNumber) setBlNumber(a.bl_number);
    if (a.invoice_number && !invoiceNumber) setInvoiceNumber(a.invoice_number);
    if (a.document_kind) setDocumentKind(a.document_kind === "facture" ? "facture" : a.document_kind === "bl" ? "bl" : "autre");
    if (a.bl_date && !blDate) setBlDate(a.bl_date);
    if (a.client_name && !clientName) setClientName(a.client_name);
    if (a.consigne && reason === "piece_non_utilisee") {
      setReason("consigne");
      setReturnType("consigne");
    }

    if (a.supplier_name && !supplierId) {
      const needle = a.supplier_name.toLowerCase();
      const found = (suppliers.data ?? []).find(
        (s) => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()),
      );
      if (found) setSupplierId(found.id);
    }

    if (a.lines?.length) {
      // Les lignes annotées à la main par le magasinier sont cochées d'office ;
      // les autres restent visibles mais décochées pour contrôle.
      const anyAnnotated = a.lines.some((l) => l.selected || (l.annotation && l.annotation !== "aucune"));
      setLines(
        a.lines.map((l) => ({
          reference: l.reference ?? "",
          label: l.label ?? "",
          quantity: l.quantity ? String(l.quantity) : "1",
          unitPrice: l.unit_price ? String(l.unit_price) : "",
          checked: anyAnnotated ? Boolean(l.selected || (l.annotation && l.annotation !== "aucune")) : true,
          annotation: l.annotation && l.annotation !== "aucune" ? l.annotation : "",
          confidence: l.confidence ?? "",
          itemType: l.item_type ?? "",
        })),
      );
      if (anyAnnotated) setMsg("Lignes annotées détectées : vérifie la sélection avant de valider.");
    }
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { reference: "", label: "", quantity: "1", unitPrice: "", checked: true }]);
  }

  async function save(status: "brouillon" | "demande_creee") {
    const checkedLines = lines.filter((l) => l.checked && (l.label.trim() || l.reference.trim()));
    if (status === "demande_creee") {
      if (!supplierId) {
        setMsg("Choisis un fournisseur avant de valider.");
        return;
      }
      if (!checkedLines.length) {
        setMsg("Coche au moins une pièce à retourner.");
        return;
      }
    }
    setBusy(true);
    try {
      const supplier = suppliers.data?.find((s) => s.id === supplierId);
      const { data: auth } = await supabase.auth.getUser();
      const expected = checkedLines.reduce((s, l) => {
        const qty = Number(l.quantity.replace(",", ".")) || 0;
        const unit = Number(l.unitPrice.replace(",", ".")) || 0;
        return s + qty * unit;
      }, 0);

      const { data, error } = await supabase
        .from("part_returns")
        .insert({
          supplier_id: supplierId || null,
          plate: plate ? normalizePlate(plate) : null,
          or_number: orNumber || null,
          status,
          return_type: returnType,
          document_kind: documentKind,
          bl_number: blNumber || null,
          invoice_number: invoiceNumber || null,
          document_date: /^\d{4}-\d{2}-\d{2}$/.test(blDate) ? blDate : null,
          reason,
          deadline_date: status === "demande_creee" ? deadlineFrom(supplier?.max_return_days) : null,
          expected_amount: expected || null,
          comments: [comments, blNumber ? `BL ${blNumber}${blDate ? ` du ${blDate}` : ""}` : "", clientName ? `Client : ${clientName}` : ""]
            .filter(Boolean)
            .join(" · ") || null,
          created_by: auth.user?.id ?? null,
          created_by_name: auth.user?.email ?? null,
          photos: photoPaths,
          analysis: (rawAnalysis as never) ?? null,
        })
        .select()
        .single();
      if (error || !data) throw error;
      const ret = data as { id: string; reference: string };

      for (const l of checkedLines) {
        const qty = Number(l.quantity.replace(",", ".")) || 1;
        const unit = l.unitPrice ? Number(l.unitPrice.replace(",", ".")) : null;
        await supabase.from("part_return_lines").insert({
          return_id: ret.id,
          label: l.label || l.reference,
          reference: l.reference || null,
          quantity: qty,
          unit_price: unit,
          item_type: l.itemType === "consigne" || reason === "consigne" ? "consigne" : "piece",
          confidence: l.confidence || null,
          annotation_hint: l.annotation || null,
          suggested: Boolean(l.annotation),
          notes: REASONS.find((r) => r.key === reason)?.label ?? reason,
        });
      }

      if (status === "demande_creee") {
        const to = await partsEmailFor(supplier?.id, supplier);
        if (notify && to) {
          const res = await sendModuleEmailFn({
            data: {
              to,
              subject: `Préavis de retour ${ret.reference}`,
              body: `Bonjour,\n\nNous souhaitons retourner ${checkedLines.length > 1 ? "les pièces suivantes" : "la pièce suivante"} :\n${checkedLines
                .map((l) => `- ${l.reference || "—"} — ${l.label || "—"} × ${l.quantity}`)
                .join("\n")}\n${plate ? `- Véhicule : ${normalizePlate(plate)}\n` : ""}${orNumber ? `- N° OR : ${orNumber}\n` : ""}${blNumber ? `- N° BL : ${blNumber}\n` : ""}\nMerci de nous confirmer l'accord de retour et la procédure à suivre.\n\nRéférence interne : ${ret.reference}\n\nCordialement,`,
              kind: "preavis_retour",
            },
          });
          if (res.ok) await supabase.from("part_returns").update({ notice_sent_at: new Date().toISOString() }).eq("id", ret.id);
        }
      }

      await navigate({ to: "/magasin/$returnId", params: { returnId: ret.id } });
    } catch {
      setMsg("Enregistrement impossible.");
      setBusy(false);
    }
  }

  return (
    <AppShell title="Demande de retour" subtitle="Magasin" back={{ to: "/magasin" }}>
      {cameraOpen ? (
        <BurstCamera
          steps={[]}
          title="Retour pièce"
          onFinish={(shots) => void runBatch(shots)}
          onCancel={() => setCameraOpen(false)}
        />
      ) : null}

      <div className="space-y-3">
        <button
          onClick={() => setCameraOpen(true)}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-brand px-4 py-6 text-brand-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
          <span className="text-lg font-extrabold uppercase tracking-wide">Scan / Photo</span>
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Plaque, OR, pièce, étiquette, BL, document fournisseur, bon de retour… dans n'importe quel ordre.
        </p>
        {photoPaths.length ? (
          <p className="text-center text-xs font-bold text-muted-foreground">{photoPaths.length} photo(s) capturée(s)</p>
        ) : null}

        {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

        {analyzed || photoPaths.length ? (
          <>
            <Section title="Fiche récapitulative">
              <Select
                label="Fournisseur"
                value={supplierId}
                onChange={setSupplierId}
                options={(suppliers.data ?? []).map((s) => ({ key: s.id, label: s.name }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Immatriculation" value={plate} onChange={setPlate} />
                <Field label="N° OR" value={orNumber} onChange={setOrNumber} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="N° BL fournisseur" value={blNumber} onChange={setBlNumber} />
                <Field label="N° facture" value={invoiceNumber} onChange={setInvoiceNumber} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date document" value={blDate} onChange={setBlDate} placeholder="AAAA-MM-JJ" />
                <Select
                  label="Document source"
                  value={documentKind}
                  onChange={setDocumentKind}
                  options={[
                    { key: "bl", label: "Bon de livraison" },
                    { key: "facture", label: "Facture" },
                    { key: "autre", label: "Autre" },
                  ]}
                  allowEmpty={false}
                />
              </div>
              <Select
                label="Type de retour"
                value={returnType}
                onChange={setReturnType}
                options={RETURN_TYPES.map((t) => ({ key: t.key, label: t.label }))}
                allowEmpty={false}
              />
              <Field label="Client" value={clientName} onChange={setClientName} />
              <Select label="Motif" value={reason} onChange={setReason} options={REASONS.map((r) => ({ key: r.key, label: r.label }))} allowEmpty={false} />
            </Section>

            <Section title="Pièces à retourner">
              <ul className="space-y-2">
                {lines.map((l, i) => (
                  <li key={i} className="card-surface flex items-start gap-2 p-3">
                    <input
                      type="checkbox"
                      checked={l.checked}
                      onChange={(e) => updateLine(i, { checked: e.target.checked })}
                      className="mt-3 h-5 w-5 shrink-0"
                    />
                    <div className="flex-1 space-y-2">
                      {l.annotation || l.confidence === "faible" ? (
                        <div className="flex flex-wrap gap-1 text-[11px] font-bold uppercase">
                          {l.annotation ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">Annotée ({l.annotation})</span>
                          ) : null}
                          {l.confidence === "faible" ? (
                            <span className="rounded bg-amber-200 px-2 py-0.5 text-amber-950">À vérifier</span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Référence" value={l.reference} onChange={(v) => updateLine(i, { reference: v })} />
                        <Field label="Désignation" value={l.label} onChange={(v) => updateLine(i, { label: v })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Quantité" value={l.quantity} onChange={(v) => updateLine(i, { quantity: v })} />
                        <Field label="Prix unitaire (€)" value={l.unitPrice} onChange={(v) => updateLine(i, { unitPrice: v })} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <button onClick={addLine} className="w-full rounded-lg border-2 border-dashed border-border py-2 text-sm font-bold uppercase text-muted-foreground">
                + Ajouter une pièce
              </button>
            </Section>

            <Area label="Commentaires" value={comments} onChange={setComments} />

            <button onClick={() => setNotify(!notify)} className={`w-full rounded-lg border-2 py-3 text-sm font-bold ${notify ? "border-brand bg-brand/10" : "border-border"}`}>
              {notify ? "Préavis fournisseur activé à la validation" : "Préavis fournisseur désactivé"}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void save("brouillon")}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-border py-4 text-sm font-extrabold uppercase disabled:opacity-50"
              >
                <Save className="h-5 w-5" /> Enregistrer en brouillon
              </button>
              <button
                onClick={() => void save("demande_creee")}
                disabled={busy}
                className="rounded-xl bg-brand py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
              >
                Valider le retour
              </button>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
