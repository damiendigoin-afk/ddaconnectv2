import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, History, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Area, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/module-access";
import { correctExpense, acknowledgeExpenseDelivery, resolveExpenseDelivery } from "@/lib/expense-revisions.functions";
import { sendExpenseRevision } from "@/lib/expense-revision-send.functions";
import { requiresAccountingInstruction, type ExpenseEdit } from "@/lib/expense-revision-rules";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, EXPENSE_ACCOUNTS, frDateTime, type ExpenseNote } from "@/lib/expenses";
import { uploadReceipt, receiptUrl } from "@/lib/expense-upload";
import { buildExpenseNotePdf, pdfToBase64 } from "@/lib/expense-pdf";
import { toastError } from "@/lib/errors";
import { toast } from "sonner";

export function ExpenseCorrection({ note, sites }: { note: ExpenseNote; sites: { id: string; name: string }[] }) {
  const { user, displayName } = useAuth();
  const perms = usePermissions();
  const qc = useQueryClient();
  const correct = useServerFn(correctExpense);
  const send = useServerFn(sendExpenseRevision);
  const ack = useServerFn(acknowledgeExpenseDelivery);
  const resolve = useServerFn(resolveExpenseDelivery);
  const [mode, setMode] = useState<"edit" | "cancel" | "history" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [instruction, setInstruction] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ExpenseEdit>(() => ({ site_id: note.site_id, merchant: note.merchant, spent_on: note.spent_on, category: note.category, purpose: note.purpose, payment_method: note.payment_method, amount_ttc: note.amount_ttc, vat_amount: note.vat_amount, vat_rate: note.vat_rate, notes: note.notes, receipt_path: note.receipt_path, receipt_mime: note.receipt_mime, account_ref: note.account_ref, account_other: note.account_other }));
  const history = useQuery({ queryKey: ["expense-history", note.id, note.revision], enabled: mode === "history", queryFn: async () => {
    const [versions, events, deliveries] = await Promise.all([supabase.from("expense_versions").select("*").eq("expense_id", note.id).order("revision", { ascending: false }), supabase.from("expense_revision_events").select("*").eq("expense_id", note.id).order("created_at", { ascending: false }), supabase.from("expense_revision_deliveries").select("*").eq("expense_id", note.id).order("created_at", { ascending: false })]);
    if (versions.error || events.error || deliveries.error) throw versions.error || events.error || deliveries.error;
    return { versions: versions.data ?? [], events: events.data ?? [], deliveries: deliveries.data ?? [] };
  }});
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["expenses"] }); void qc.invalidateQueries({ queryKey: ["expense-history"] }); };
  const allowed = perms.canValidateExpenses || perms.canAccountExpenses || (note.user_id === user?.id && ["brouillon", "soumis", "refuse"].includes(note.status));
  async function save() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const patch = { ...draft };
      for (const k of ["amount_ttc", "vat_amount", "vat_rate"] as const) { const value = String(patch[k] ?? "").trim().replace(",", "."); patch[k] = value ? Number(value) : null; }
      if (file) { const up = await uploadReceipt(file, file.name, user.id); patch.receipt_path = up.path; patch.receipt_mime = up.mime; }
      await correct({ data: { expenseId: note.id, revision: note.revision, action: mode === "cancel" ? "cancel" : "edit", patch: mode === "cancel" ? {} : patch, reason, instruction } });
      toast.success(mode === "cancel" ? "Note annulée — transmission comptable séparée si nécessaire" : "Correction enregistrée — nouvelle validation requise");
      setMode(null); refresh();
    } catch (e) { toastError(e, "Correction impossible"); } finally { setBusy(false); }
  }
  async function transmit() {
    if (busy) return;
    setBusy(true);
    try {
      const bytes = await buildExpenseNotePdf({ note: { ...note, validated_at: note.cancelled_at ? null : new Date().toISOString(), validated_by_name: displayName }, siteLabel: sites.find(s => s.id === note.site_id)?.name ?? "—", receiptUrl: await receiptUrl(note.receipt_path) });
      const result = await send({ data: { expenseId: note.id, revision: note.revision, pdfBase64: pdfToBase64(bytes) } });
      if (!result.ok) throw new Error(result.error);
      toast.success("Circuit comptable mis à jour"); refresh();
    } catch (e) { toastError(e, "Transmission à contrôler"); } finally { setBusy(false); }
  }
  return <div className="mt-3 border-t border-border pt-3">
    <div className="flex flex-wrap gap-2">
      {allowed && !note.cancelled_at && <Button size="sm" variant="outline" onClick={() => setMode(mode === "edit" ? null : "edit")}><Pencil />Modifier</Button>}
      {allowed && !note.cancelled_at && <Button size="sm" variant="outline" onClick={() => setMode("cancel")}><Ban />Annuler</Button>}
      <Button size="sm" variant="ghost" onClick={() => setMode(mode === "history" ? null : "history")}><History />Historique · v{note.revision}</Button>
      {perms.canValidateExpenses && note.revision > 1 && ["soumis", "valide", "annulee"].includes(note.status) && <Button size="sm" disabled={busy} onClick={() => void transmit()}>{note.cancelled_at ? "Notifier l’annulation si déjà envoyée" : "Valider et transmettre la correction"}</Button>}
    </div>
    {(mode === "edit" || mode === "cancel") && <div className="mt-3 space-y-3">
      {mode === "edit" && <>
        <Select label="Établissement" value={String(draft.site_id ?? "")} onChange={v => setDraft({ ...draft, site_id: v })} options={sites.map(s => ({ key: s.id, label: s.name }))} allowEmpty={false} />
        {([ ["merchant", "Fournisseur"], ["spent_on", "Date"], ["purpose", "Motif détaillé"], ["amount_ttc", "Montant TTC (€)"], ["vat_amount", "TVA totale (€)"], ["vat_rate", "Taux TVA (%)"] ] as const).map(([key, label]) => <Field key={key} label={label} type={key === "spent_on" ? "date" : "text"} value={String(draft[key] ?? "")} onChange={v => setDraft({ ...draft, [key]: v })} />)}
        <Select label="Catégorie" value={String(draft.category)} options={EXPENSE_CATEGORIES} allowEmpty={false} onChange={v => setDraft({ ...draft, category: v })} />
        <Select label="Règlement" value={String(draft.payment_method)} options={PAYMENT_METHODS} allowEmpty={false} onChange={v => setDraft({ ...draft, payment_method: v })} />
        {draft.payment_method === "en_compte" && <><Select label="Compte" value={String(draft.account_ref ?? "")} options={EXPENSE_ACCOUNTS} onChange={v => setDraft({ ...draft, account_ref: v })} /><Field label="Précision compte" value={String(draft.account_other ?? "")} onChange={v => setDraft({ ...draft, account_other: v })} /></>}
        <Area label="Commentaire" value={String(draft.notes ?? "")} onChange={v => setDraft({ ...draft, notes: v })} />
        <p>Nouveau justificatif (original conservé dans l’historique)</p>
        <input aria-label="Remplacer le justificatif" type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </>}
      <Area label="Motif de correction / annulation *" value={reason} onChange={setReason} />
      {requiresAccountingInstruction(note) && <p className="text-sm text-status-watch">Déjà réglée, rapprochée, exportée ou comptabilisée : régularisation / extourne nécessaire. L’écriture antérieure est conservée.</p>}
      <Area label="Traitement comptable demandé" value={instruction} onChange={setInstruction} />
      <Button disabled={busy || reason.trim().length < 3 || (requiresAccountingInstruction(note) && instruction.trim().length < 3)} onClick={() => void save()}>{busy ? "Enregistrement…" : mode === "cancel" ? "Confirmer l’annulation" : "Enregistrer la correction"}</Button>
    </div>}
    {mode === "history" && <div className="mt-3 space-y-3 text-xs">
      {note.sent_at && <p>Envoi enregistré sur la note : {note.accounting_email} · {frDateTime(note.sent_at)}</p>}
      {history.isLoading && <p>Chargement…</p>}{history.error && <p>Historique inaccessible.</p>}
      {history.data?.versions.map(v => <details key={v.id}><summary>Version {v.revision} · {v.actor_name} · {frDateTime(v.created_at)} · {v.reason}</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(v.snapshot, null, 2)}</pre></details>)}
      {perms.canAccountExpenses && history.data?.deliveries.filter(d => ["unknown", "sending"].includes(d.state)).map(d => <div key={`resolve-${d.id}`} className="space-y-2"><p>Envoi incertain vers {d.recipient} : vérifiez les journaux d’envoi avant de trancher.</p>{[true, false].map(sent => <Button key={String(sent)} size="sm" variant="outline" onClick={async () => { const proof = window.prompt(sent ? "Preuve / référence fournisseur confirmant l’envoi" : "Preuve du contrôle confirmant l’absence d’envoi (réessai ensuite possible)"); if (!proof) return; try { await resolve({ data: { deliveryId: d.id, sent, proof } }); refresh(); } catch (e) { toastError(e, "Résolution impossible"); } }}>{sent ? "Envoi confirmé après contrôle" : "Absence d’envoi vérifiée"}</Button>)}</div>)}
      {history.data?.events.map(e => <details key={e.id}><summary>{e.action} · {e.actor_name || "Utilisateur"} · {frDateTime(e.created_at)}</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(e.detail, null, 2)}</pre></details>)}
      {history.data?.deliveries.map(d => <div key={d.id} className="border-t border-border py-2"><p>v{d.revision} {d.kind} → {d.recipient} · {d.state === "sent" ? "Envoyé" : d.state === "unknown" || d.state === "sending" ? "À contrôler — aucun réessai automatique" : d.state === "failed" ? "Échec — réessai possible" : "À envoyer"}</p><p>{d.processed_at ? `Traité par comptabilité : ${d.processing_reference} · ${frDateTime(d.processed_at)}` : "Non confirmé traité par comptabilité"}</p><Button variant="link" size="sm" onClick={async () => { const url = await receiptUrl(d.pdf_path); if (url) window.open(url, "_blank", "noopener"); }}>PDF de cet envoi</Button>{perms.canAccountExpenses && d.state === "sent" && !d.processed_at && <Button size="sm" variant="outline" onClick={async () => { const reference = window.prompt("Référence de l’écriture / extourne comptable effectivement traitée"); if (!reference) return; try { await ack({ data: { deliveryId: d.id, reference } }); refresh(); } catch (e) { toastError(e, "Confirmation impossible"); } }}>Confirmer traité par comptabilité</Button>}</div>)}
    </div>}
  </div>;
}