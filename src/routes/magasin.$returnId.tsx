import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Copy, Loader2, Send, Truck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET, compressImage, mediaUrl } from "@/lib/photo";
import { formatPlate } from "@/lib/plate";
import { listSuppliers } from "@/lib/suppliers";
import { sendReturnMailFn } from "@/lib/returns.functions";
import {
  CLOSURE_REASONS,
  DOCUMENT_KINDS,
  HANDOVER_MODES,
  RECEPTION_ANSWERS,
  SUPPLIER_ANSWERS,
  addDocument,
  ageDays,
  documentKindLabel,
  getReturn,
  handoverLabel,
  isConsigne,
  listDocuments,
  listEvents,
  logEvent,
  pendingAmount,
  reasonLabel,
  returnStatusLabel,
  returnStatusTone,
  returnTypeLabel,
  type ReturnWithLines,
} from "@/lib/returns";

export const Route = createFileRoute("/magasin/$returnId")({
  head: () => ({
    meta: [
      { title: "Dossier de retour — DDA Connect" },
      { name: "description", content: "Accord fournisseur, expédition, réception, avoir et litige d'un retour de pièce." },
      { property: "og:title", content: "Dossier de retour — DDA Connect" },
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

function ReturnDetail({ row, returnId }: { row: ReturnWithLines; returnId: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const events = useQuery({ queryKey: ["return-events", returnId], queryFn: () => listEvents(returnId) });
  const docs = useQuery({ queryKey: ["return-docs", returnId], queryFn: () => listDocuments(returnId) });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [docKind, setDocKind] = useState("photo_piece");

  // Remise / expédition
  const [mode, setMode] = useState(row.handover_mode ?? "transporteur");
  const [person, setPerson] = useState(row.handover_person ?? "");
  const [company, setCompany] = useState(row.handover_company ?? "");
  const [place, setPlace] = useState(row.handover_place ?? "");
  const [carrier, setCarrier] = useState(row.carrier ?? "");
  const [tracking, setTracking] = useState(row.tracking_number ?? "");

  // Réponses manuelles
  const [accord, setAccord] = useState("accepte");
  const [accordNote, setAccordNote] = useState("");
  const [reception, setReception] = useState("recu");
  const [receptionNote, setReceptionNote] = useState("");

  // Avoir
  const [creditNumber, setCreditNumber] = useState("");
  const [creditAmount, setCreditAmount] = useState("");

  // Clôture
  const [closureReason, setClosureReason] = useState("avoir_recu");
  const [closureComment, setClosureComment] = useState("");

  const supplier = suppliers.data?.find((s) => s.id === row.supplier_id);
  const expected = Number(row.expected_amount ?? 0) + Number(row.deposit_amount ?? 0);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["return", returnId] });
    void qc.invalidateQueries({ queryKey: ["return-events", returnId] });
    void qc.invalidateQueries({ queryKey: ["return-docs", returnId] });
    void qc.invalidateQueries({ queryKey: ["returns"] });
  };

  async function patch(values: Record<string, unknown>, event?: { kind: string; detail: string }) {
    setBusy(true);
    setMsg("");
    try {
      const { error } = await supabase.from("part_returns").update(values).eq("id", returnId);
      if (error) throw error;
      if (event) await logEvent(returnId, event.kind, event.detail);
      reload();
    } catch {
      setMsg("Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function mail(kind: "accord" | "expedition" | "reception" | "relance" | "escalade") {
    setBusy(true);
    setMsg("Envoi en cours…");
    try {
      const res = await sendReturnMailFn({ data: { returnId, kind } });
      setMsg(res.ok ? `E-mail envoyé à ${res.to}.` : res.error || "Envoi impossible.");
      reload();
    } catch {
      setMsg("Envoi impossible (service e-mail indisponible).");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg("Ajout du document…");
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const blob = isImage ? await compressImage(file) : file;
        const ext = isImage ? "jpg" : (file.name.split(".").pop() ?? "bin");
        const path = `returns/${returnId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
          contentType: isImage ? "image/jpeg" : file.type || "application/octet-stream",
        });
        if (error) throw error;
        await addDocument(returnId, { kind: docKind, storagePath: path, filename: file.name, mimeType: file.type, source: "interne" });
      }
      setMsg("Document ajouté.");
      reload();
    } catch {
      setMsg("Ajout du document impossible.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveCredit() {
    const amount = Number(creditAmount.replace(",", "."));
    if (!amount) {
      setMsg("Montant d'avoir invalide.");
      return;
    }
    const credited = Number(row.credited_amount ?? 0) + amount;
    await patch(
      {
        credited_amount: credited,
        status: credited + 0.01 >= expected ? "totalement_avoire" : "partiellement_avoire",
      },
      { kind: "avoir", detail: `Avoir ${creditNumber || "sans numéro"} : ${amount.toFixed(2)} € (cumul ${credited.toFixed(2)} € / ${expected.toFixed(2)} €)` },
    );
    setCreditAmount("");
    setCreditNumber("");
  }

  const shareLink = row.share_token ? `${typeof window !== "undefined" ? window.location.origin : ""}/retour-fournisseur/${row.share_token}` : "";

  return (
    <AppShell
      title={row.reference}
      subtitle={`${supplier?.name ?? "Fournisseur ?"} · ${returnTypeLabel(row.return_type)}`}
      back={{ to: "/magasin" }}
      right={<Badge tone={returnStatusTone(row.status)}>{returnStatusLabel(row.status)}</Badge>}
    >
      {msg ? <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

      <Section title="Synthèse">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Ouvert depuis" value={`${ageDays(row.created_at)} jours`} />
          <Info label="Motif" value={reasonLabel(row.reason)} />
          <Info label="BL" value={row.bl_number ?? "—"} />
          <Info label="Facture" value={row.invoice_number ?? "—"} />
          <Info label="OR" value={row.or_number ?? "—"} />
          <Info label="Date document" value={row.document_date ?? "—"} />
          <Info label="Montant attendu" value={`${expected.toFixed(2)} €`} />
          <Info label="Avoir reçu" value={`${Number(row.credited_amount ?? 0).toFixed(2)} €`} />
          <Info label="Reste dû" value={`${pendingAmount(row).toFixed(2)} €`} />
          <Info label="Échéance" value={row.deadline_date ?? "—"} />
        </div>
        {row.plate ? <div className="mt-2 plate-badge text-lg">{formatPlate(row.plate)}</div> : null}
        {isConsigne(row) ? <div className="mt-2"><Badge tone="bg-orange-200 text-orange-950">Consigne</Badge></div> : null}
      </Section>

      <Section title={`Pièces (${row.lines.length})`}>
        <ul className="space-y-2">
          {row.lines.map((l) => (
            <li key={l.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{l.reference || "Sans référence"}</span>
                <span>{Number(l.quantity ?? 0)} × {l.unit_price != null ? `${Number(l.unit_price).toFixed(2)} €` : "—"}</span>
              </div>
              <div className="text-xs text-muted-foreground">{l.label || "—"}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {l.item_type === "consigne" ? <Badge tone="bg-orange-200 text-orange-950">Consigne</Badge> : null}
                {l.confidence === "faible" ? <Badge tone="bg-amber-200 text-amber-950">À vérifier</Badge> : null}
                {l.annotation_hint ? <Badge>Annotation : {l.annotation_hint}</Badge> : null}
                {Number(l.credited_quantity ?? 0) > 0 ? (
                  <Badge tone="bg-emerald-100 text-emerald-900">Avoiré {Number(l.credited_amount ?? 0).toFixed(2)} €</Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Accord fournisseur">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void mail("accord")}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Demander l'accord
          </button>
          <button
            onClick={() => void mail("relance")}
            disabled={busy}
            className="rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
          >
            Relancer ({row.reminder_count})
          </button>
        </div>
        <Select label="Réponse reçue (saisie manuelle)" value={accord} onChange={setAccord} options={SUPPLIER_ANSWERS.map((a) => ({ key: a.key, label: a.label }))} allowEmpty={false} />
        <Area label="Commentaire fournisseur" value={accordNote} onChange={setAccordNote} />
        <button
          onClick={() =>
            void patch(
              {
                accord_status: accord,
                accord_response_at: new Date().toISOString(),
                accord_comment: accordNote || null,
                status:
                  accord === "accepte" ? "accord_accepte" : accord === "refuse" ? "refus" : accord === "info" ? "info_requise" : accord === "non_concerne" ? "non_concerne" : "accord_attendu",
              },
              { kind: "accord", detail: `Réponse fournisseur enregistrée : ${accord}${accordNote ? ` — ${accordNote}` : ""}` },
            )
          }
          disabled={busy}
          className="w-full rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
        >
          Enregistrer la réponse
        </button>
        {row.accord_status ? (
          <p className="text-xs text-muted-foreground">
            Dernière réponse : {row.accord_status} {row.accord_response_at ? `le ${new Date(row.accord_response_at).toLocaleDateString("fr-FR")}` : ""}
          </p>
        ) : null}
      </Section>

      <Section title="Remise / expédition">
        <Select label="Mode" value={mode} onChange={setMode} options={HANDOVER_MODES.map((m) => ({ key: m.key, label: m.label }))} allowEmpty={false} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Personne" value={person} onChange={setPerson} />
          <Field label="Société" value={company} onChange={setCompany} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lieu" value={place} onChange={setPlace} />
          <Field label="Transporteur" value={carrier} onChange={setCarrier} />
        </div>
        <Field label="N° de suivi" value={tracking} onChange={setTracking} />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() =>
              void patch(
                {
                  handover_mode: mode,
                  handover_person: person || null,
                  handover_company: company || null,
                  handover_place: place || null,
                  handover_at: new Date().toISOString(),
                  carrier: carrier || null,
                  tracking_number: tracking || null,
                  shipped_at: new Date().toISOString(),
                  status: "expedie",
                },
                { kind: "expedition", detail: `Retour remis (${handoverLabel(mode)})${person ? ` à ${person}` : ""}${tracking ? ` — suivi ${tracking}` : ""}` },
              )
            }
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            <Truck className="h-4 w-4" /> Enregistrer le départ
          </button>
          <button
            onClick={() => void mail("expedition")}
            disabled={busy}
            className="rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
          >
            Prévenir le fournisseur
          </button>
        </div>
      </Section>

      <Section title="Réception fournisseur">
        <button
          onClick={() => void mail("reception")}
          disabled={busy}
          className="w-full rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
        >
          Demander la confirmation de réception
        </button>
        <Select label="Réponse réception" value={reception} onChange={setReception} options={RECEPTION_ANSWERS.map((a) => ({ key: a.key, label: a.label }))} allowEmpty={false} />
        <Area label="Commentaire" value={receptionNote} onChange={setReceptionNote} />
        <button
          onClick={() =>
            void patch(
              {
                reception_status: reception,
                reception_confirmed_at: new Date().toISOString(),
                reception_comment: receptionNote || null,
                status:
                  reception === "recu" ? "reception_confirmee" : reception === "non_recu" ? "non_recu" : reception === "partiel" ? "reception_partielle" : reception === "probleme" ? "litige" : "non_concerne",
              },
              { kind: "reception", detail: `Réception : ${reception}${receptionNote ? ` — ${receptionNote}` : ""}` },
            )
          }
          disabled={busy}
          className="w-full rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
        >
          Enregistrer la réception
        </button>
      </Section>

      <Section title="Avoir / consigne">
        <div className="grid grid-cols-2 gap-2">
          <Field label="N° d'avoir" value={creditNumber} onChange={setCreditNumber} />
          <Field label="Montant (€)" value={creditAmount} onChange={setCreditAmount} />
        </div>
        <button
          onClick={() => void saveCredit()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Enregistrer l'avoir
        </button>
        {pendingAmount(row) > 0 ? (
          <p className="text-xs text-muted-foreground">Écart restant : {pendingAmount(row).toFixed(2)} €</p>
        ) : (
          <p className="text-xs text-emerald-700">Montant intégralement avoiré.</p>
        )}
      </Section>

      <Section title="Litige et escalade">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void patch({ status: "litige" }, { kind: "litige", detail: "Dossier passé en litige" })}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-red-300 py-3 text-sm font-extrabold uppercase text-red-700 disabled:opacity-50"
          >
            <AlertTriangle className="h-4 w-4" /> Déclarer un litige
          </button>
          <button
            onClick={() => void mail("escalade")}
            disabled={busy}
            className="rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase disabled:opacity-50"
          >
            Escalader
          </button>
        </div>
      </Section>

      <Section title="Documents">
        <Select label="Type de document" value={docKind} onChange={setDocKind} options={DOCUMENT_KINDS.map((d) => ({ key: d.key, label: d.label }))} allowEmpty={false} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple capture="environment" onChange={(e) => void upload(e.target.files)} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-4 text-sm font-extrabold uppercase disabled:opacity-50"
        >
          <Camera className="h-5 w-5" /> Ajouter photo / document
        </button>
        <ul className="space-y-2">
          {(docs.data ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-bold">{documentKindLabel(d.kind)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.source === "fournisseur" ? "Déposé par le fournisseur" : d.uploaded_by_name || "Interne"} ·{" "}
                  {new Date(d.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <button
                onClick={async () => {
                  const url = await mediaUrl(d.storage_path);
                  if (url) window.open(url, "_blank", "noopener");
                }}
                className="shrink-0 rounded-lg border border-border px-3 py-1 text-xs font-bold uppercase"
              >
                Ouvrir
              </button>
            </li>
          ))}
          {docs.data?.length ? null : <p className="text-xs text-muted-foreground">Aucun document.</p>}
        </ul>
      </Section>

      <Section title="Lien fournisseur">
        {shareLink ? (
          <button
            onClick={() => void navigator.clipboard?.writeText(shareLink)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border py-3 text-sm font-extrabold uppercase"
          >
            <Copy className="h-4 w-4" /> Copier le lien de réponse
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Le lien sécurisé est créé automatiquement au premier e-mail envoyé au fournisseur.
          </p>
        )}
      </Section>

      <Section title="Clôture">
        <Select label="Motif" value={closureReason} onChange={setClosureReason} options={CLOSURE_REASONS.map((c) => ({ key: c.key, label: c.label }))} allowEmpty={false} />
        <Area label="Commentaire" value={closureComment} onChange={setClosureComment} />
        <button
          onClick={() =>
            void patch(
              {
                status: "cloture",
                closed_at: new Date().toISOString(),
                closure_reason: closureReason,
                closure_comment: closureComment || null,
              },
              { kind: "cloture", detail: `Dossier clôturé (${closureReason})${closureComment ? ` — ${closureComment}` : ""}` },
            )
          }
          disabled={busy}
          className="w-full rounded-xl bg-foreground py-3 text-sm font-extrabold uppercase text-background disabled:opacity-50"
        >
          Clôturer le dossier
        </button>
      </Section>

      <Section title="Chronologie">
        <ul className="space-y-2">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="rounded-lg border border-border p-2 text-sm">
              <div className="text-xs text-muted-foreground">
                {new Date(e.created_at).toLocaleString("fr-FR")} · {e.actor_name || "—"}
              </div>
              <div>{e.detail || e.kind}</div>
            </li>
          ))}
          {events.data?.length ? null : <p className="text-xs text-muted-foreground">Aucun événement.</p>}
        </ul>
      </Section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[11px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
