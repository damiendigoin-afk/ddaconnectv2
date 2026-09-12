import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, ScanLine, Send } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { usePermissions } from "@/lib/module-access";
import { toastError } from "@/lib/errors";
import { fetchSites, type Site } from "@/lib/sites";
import { ocrExpenseReceipt } from "@/lib/expense-ocr.functions";
import { validateAndSendExpense } from "@/lib/expense-mail.functions";
import { transitionExpense } from "@/lib/expense-actions.functions";
import { buildExpenseNotePdf, pdfToBase64 } from "@/lib/expense-pdf";
import { blobToDataUrl, receiptUrl, uploadReceipt } from "@/lib/expense-upload";
import {
  accountLabel,
  canDeleteExpense,
  categoryLabel,
  createExpense,
  deleteExpense,
  euros,
  EXPENSE_ACCOUNTS,
  EXPENSE_CATEGORIES,
  frDate,
  frDateTime,
  guessCategory,
  isAccountPayment,
  isPersonalPayment,
  listExpenses,
  PAYMENT_METHODS,
  paymentLabel,
  statusLabel,
  statusTone,
  type ExpenseNote,
  type ExpenseScope,
} from "@/lib/expenses";


export const Route = createFileRoute("/notes-frais/")({
  head: () => ({
    meta: [
      { title: "Notes de frais — Scan, validation et comptabilité — DDA Connect" },
      {
        name: "description",
        content:
          "Scan du justificatif, motif et moyen de règlement, document A4, validation manager puis envoi automatique à la comptabilité de l'établissement.",
      },
      { property: "og:title", content: "Notes de frais — DDA Connect" },
      { property: "og:description", content: "Justificatifs scannés, validation et suivi des remboursements." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpenseHub,
});

type Draft = {
  spent_on: string;
  category: string;
  purpose: string;
  merchant: string;
  amount_ttc: string;
  vat_amount: string;
  vat_rate: string;
  payment_method: string;
  account_ref: string;
  account_other: string;
  site_id: string;
  notes: string;
};

function emptyDraft(siteId: string): Draft {
  return {
    spent_on: new Date().toISOString().slice(0, 10),
    category: "restaurant",
    purpose: "",
    merchant: "",
    amount_ttc: "",
    vat_amount: "",
    vat_rate: "",
    payment_method: "perso",
    account_ref: "",
    account_other: "",
    site_id: siteId,
    notes: "",
  };
}


function ExpenseHub() {
  const qc = useQueryClient();
  const { user, displayName } = useAuth();
  const { site } = useSite();
  const perms = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);

  const [scope, setScope] = useState<ExpenseScope>("mine");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(site?.id ?? ""));
  const [receipt, setReceipt] = useState<{ file: Blob; name: string; preview: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  const sites = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const rows = useQuery({
    queryKey: ["expenses", scope, user?.id],
    queryFn: () => listExpenses(scope, user?.id ?? null),
    enabled: !!user,
  });
  const pending = useQuery({
    queryKey: ["expenses", "to_validate", "count"],
    queryFn: () => listExpenses("to_validate", null),
    enabled: perms.canValidateExpenses,
  });

  const list = rows.data ?? [];
  const total = useMemo(() => list.reduce((s, e) => s + Number(e.amount_ttc || 0), 0), [list]);
  const siteName = (id: string | null) => sites.data?.find((s) => s.id === id)?.name ?? "—";

  /* --------------------------- Scan du justificatif ------------------------ */
  async function onPick(file: File) {
    setOpen(true);
    const preview = file.type === "application/pdf" ? "" : URL.createObjectURL(file);
    setReceipt({ file, name: file.name, preview });
    setScanning(true);
    try {
      const dataUrl = await blobToDataUrl(file);
      const res = await ocrExpenseReceipt({ data: { dataUrl, filename: file.name } });
      if (!res.ok) {
        toast.message("Lecture automatique indisponible", { description: "Complétez la note à la main." });
        return;
      }
      const j = JSON.parse(res.json) as Record<string, unknown>;
      const guessed =
        (typeof j["category"] === "string" ? (j["category"] as string) : null) ??
        guessCategory([j["merchant"], j["raw_text"]].filter(Boolean).join(" "));
      setDraft((d) => ({
        ...d,
        merchant: typeof j["merchant"] === "string" ? (j["merchant"] as string) : d.merchant,
        spent_on: typeof j["date"] === "string" ? (j["date"] as string).slice(0, 10) : d.spent_on,
        amount_ttc: j["amount_ttc"] != null ? String(j["amount_ttc"]) : d.amount_ttc,
        vat_amount: j["vat_amount"] != null ? String(j["vat_amount"]) : d.vat_amount,
        vat_rate: j["vat_rate"] != null ? String(j["vat_rate"]) : d.vat_rate,
        category: EXPENSE_CATEGORIES.some((c) => c.key === guessed) ? (guessed as string) : d.category,
      }));
      toast.success("Justificatif lu — vérifiez les informations");
    } catch (e) {
      toastError(e, "Lecture du justificatif impossible — saisie manuelle");
    } finally {
      setScanning(false);
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      let path: string | null = null;
      let mime: string | null = null;
      if (receipt) {
        const up = await uploadReceipt(receipt.file, receipt.name, user!.id);
        path = up.path;
        mime = up.mime;
      }
      await createExpense({
        user_id: user!.id,
        user_name: displayName || null,
        site_id: draft.site_id || null,
        spent_on: draft.spent_on,
        category: draft.category,
        purpose: draft.purpose || categoryLabel(draft.category),
        merchant: draft.merchant || null,
        amount_ttc: Number(draft.amount_ttc || 0),
        vat_amount: draft.vat_amount ? Number(draft.vat_amount) : null,
        vat_rate: draft.vat_rate ? Number(draft.vat_rate) : null,
        payment_method: draft.payment_method,
        receipt_path: path,
        receipt_mime: mime,
        notes: draft.notes || null,
        status: "soumis",
        submitted_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast.success("Note envoyée à la validation");
      setOpen(false);
      setReceipt(null);
      setDraft(emptyDraft(site?.id ?? ""));
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toastError(e, "Enregistrement de la note impossible"),
  });

  /* ------------------------ Validation + envoi compta ---------------------- */
  const validate = useMutation({
    mutationFn: async (note: ExpenseNote) => {
      const url = await receiptUrl(note.receipt_path);
      const bytes = await buildExpenseNotePdf({
        note: { ...note, validated_at: new Date().toISOString(), validated_by_name: displayName },
        siteLabel: siteName(note.site_id),
        receiptUrl: url,
      });
      const res = await validateAndSendExpense({
        data: { expenseId: note.id, pdfBase64: pdfToBase64(bytes), attempt: crypto.randomUUID() },
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Note validée et transmise à la comptabilité");
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      toastError(e, "Envoi à la comptabilité impossible");
    },
  });

  const change = useMutation({
    mutationFn: ({ id, action, detail }: { id: string; action: "resubmit" | "reject" | "settle" | "account" | "mark_seen"; detail?: string }) =>
      transitionExpense({ data: { expenseId: id, action, detail } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (e) => toastError(e, "Mise à jour impossible"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (e) => toastError(e, "Suppression impossible"),
  });

  async function openPdf(note: ExpenseNote) {
    try {
    const frozen = note.validated_pdf_path ? await receiptUrl(note.validated_pdf_path) : null;
    if (frozen) {
      window.open(frozen, "_blank");
      return;
    }
    const url = await receiptUrl(note.receipt_path);
      const bytes = await buildExpenseNotePdf({ note, siteLabel: siteName(note.site_id), receiptUrl: url });
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      toastError(e, "Document indisponible");
    }
  }

  const tabs: { key: ExpenseScope; label: string; count?: number }[] = [
    { key: "mine", label: "Mes notes" },
    ...(perms.canValidateExpenses
      ? [{ key: "to_validate" as ExpenseScope, label: "À valider", count: pending.data?.length ?? 0 }]
      : []),
    ...(perms.canAccountExpenses ? [{ key: "accounting" as ExpenseScope, label: "Comptabilité" }] : []),
  ];

  return (
    <AppShell title="Notes de frais" subtitle="Justificatifs et remboursements" back={{ to: "/" }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPick(f);
        }}
      />

      <button
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-sm font-extrabold uppercase text-brand-foreground active:scale-[0.99]"
      >
        <ScanLine className="h-5 w-5" /> Scanner un justificatif
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-xs font-bold uppercase"
      >
        {open ? "Fermer la saisie" : "Saisir sans justificatif"}
      </button>

      {tabs.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold uppercase ${
                scope === t.key ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card"
              }`}
            >
              {t.label}
              {t.count ? (
                <span className="rounded-full bg-status-watch px-2 py-0.5 text-[10px] text-white">{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border-2 border-border bg-card p-3">
        <div className="text-2xl font-extrabold">{euros(total)}</div>
        <div className="text-[11px] font-bold uppercase text-muted-foreground">Total affiché</div>
      </div>

      {open ? (
        <Section title="Nouvelle note de frais">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            {scanning ? (
              <p className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lecture du justificatif…
              </p>
            ) : null}
            {receipt ? (
              <div className="flex items-center gap-3 rounded-lg bg-secondary/50 p-2">
                {receipt.preview ? (
                  <img src={receipt.preview} alt="Justificatif" className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded bg-card text-xs font-bold">PDF</div>
                )}
                <div className="min-w-0 flex-1 truncate text-xs">{receipt.name}</div>
                <button onClick={() => setReceipt(null)} className="text-xs font-bold uppercase text-muted-foreground">
                  Retirer
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-xs font-bold uppercase text-muted-foreground"
              >
                <Camera className="h-4 w-4" /> Ajouter photo ou PDF
              </button>
            )}

            <Field label="Date" type="date" value={draft.spent_on} onChange={(v) => setDraft({ ...draft, spent_on: v })} />
            <Field label="Fournisseur / enseigne" value={draft.merchant} onChange={(v) => setDraft({ ...draft, merchant: v })} />
            <Field label="Montant TTC (€)" type="number" value={draft.amount_ttc} onChange={(v) => setDraft({ ...draft, amount_ttc: v })} />
            <Field label="Dont TVA (€)" type="number" value={draft.vat_amount} onChange={(v) => setDraft({ ...draft, vat_amount: v })} />
            <Select
              label="Motif *"
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v })}
              options={EXPENSE_CATEGORIES}
              allowEmpty={false}
            />
            <Select
              label="Moyen de règlement *"
              value={draft.payment_method}
              onChange={(v) => setDraft({ ...draft, payment_method: v })}
              options={PAYMENT_METHODS.map((p) => ({ key: p.key, label: p.label }))}
              allowEmpty={false}
            />
            <Select
              label="Établissement *"
              value={draft.site_id}
              onChange={(v) => setDraft({ ...draft, site_id: v })}
              options={(sites.data ?? []).map((s: Site) => ({ key: s.id, label: s.name }))}
              allowEmpty
            />
            <Area label="Commentaire (facultatif)" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
            <p className="text-[11px] text-muted-foreground">
              {isPersonalPayment(draft.payment_method)
                ? "Paiement personnel : un remboursement vous sera dû après validation."
                : "Paiement entreprise : justificatif comptable uniquement, aucun remboursement."}
            </p>
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !draft.amount_ttc || !draft.site_id || !draft.payment_method || !draft.category}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              {create.isPending ? "Envoi…" : "Envoyer à la validation"}
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`${list.length} note${list.length > 1 ? "s" : ""}`}>
        {!rows.isLoading && !list.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune note à afficher.
          </p>
        ) : null}
        <div className="space-y-2">
          {list.map((e) => {
            const personal = isPersonalPayment(e.payment_method);
            const failed = e.send_status === "failed";
            return (
              <div key={e.id} className="rounded-xl border-2 border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                  <Badge>{e.purpose || categoryLabel(e.category)}</Badge>
                  <Badge tone={personal ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground"}>
                    {paymentLabel(e.payment_method)}
                  </Badge>
                  <span className="ml-auto text-sm font-extrabold">{euros(e.amount_ttc)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {frDate(e.spent_on)}
                  {e.merchant ? ` · ${e.merchant}` : ""}
                  {` · ${siteName(e.site_id)}`}
                  {scope !== "mine" && e.user_name ? ` · ${e.user_name}` : ""}
                </div>
                {e.validated_at ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Validée par {e.validated_by_name ?? "—"} le {frDateTime(e.validated_at)}
                    {e.sent_at ? ` · transmise à ${e.accounting_email} le ${frDateTime(e.sent_at)}` : ""}
                  </p>
                ) : null}
                {e.settled_at ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-status-ok">
                    <CheckCircle2 className="h-3 w-3" /> Remboursement réglé le {frDate(e.settled_at)}
                  </p>
                ) : null}
                {e.accounted_at ? (
                  <p className="mt-1 text-[11px] font-bold text-status-ok">Comptabilisée le {frDateTime(e.accounted_at)}</p>
                ) : null}
                {e.user_id === user?.id && !e.employee_notified_at && (e.status === "reglee" || e.status === "comptabilisee") ? (
                  <p className="mt-2 rounded-lg bg-status-ok-soft px-2 py-2 text-[11px] font-bold text-status-ok">
                    {e.status === "reglee"
                      ? `Votre remboursement a été réglé le ${frDate(e.settled_at)}.`
                      : "Votre justificatif a été comptabilisé."}
                  </p>
                ) : null}
                {e.reject_reason ? <p className="mt-1 text-xs text-status-watch">À corriger : {e.reject_reason}</p> : null}
                {failed ? (
                  <p className="mt-2 flex items-center gap-2 rounded-lg bg-red-100 px-2 py-2 text-[11px] font-bold text-red-800">
                    <AlertTriangle className="h-4 w-4" /> Validée — envoi comptable échoué. Non transmise.
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  <Act label="Document A4" onClick={() => void openPdf(e)} />
                  {e.status === "brouillon" || e.status === "refuse" ? (
                    <Act
                      label="Soumettre"
                       onClick={() => change.mutate({ id: e.id, action: "resubmit" })}
                    />
                  ) : null}
                  {perms.canValidateExpenses && (e.status === "soumis" || failed) ? (
                    <>
                      <Act
                        label={validate.isPending ? "Envoi…" : failed ? "Renvoyer" : "Valider et transmettre"}
                        primary
                        onClick={() => validate.mutate(e)}
                      />
                      {e.status === "soumis" ? (
                        <Act
                          label="Refuser / à corriger"
                          onClick={() => {
                            const reason = window.prompt("Motif du refus ou correction demandée ?") ?? "";
                             if (reason) change.mutate({ id: e.id, action: "reject", detail: reason });
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {perms.canAccountExpenses && e.status === "transmise" && personal ? (
                    <Act
                      label="Marquer comme réglé"
                      primary
                      onClick={() => {
                        const d = window.prompt("Date de règlement (AAAA-MM-JJ)", new Date().toISOString().slice(0, 10));
                        if (d)
                          change.mutate({
                            id: e.id,
                             action: "settle",
                             detail: d,
                          });
                      }}
                    />
                  ) : null}
                  {perms.canAccountExpenses && e.status === "transmise" && !personal ? (
                    <Act
                      label="Marquer comptabilisé"
                      primary
                      onClick={() =>
                        change.mutate({
                          id: e.id,
                           action: "account",
                        })
                      }
                    />
                  ) : null}
                  {e.user_id === user?.id && !e.employee_notified_at && (e.status === "reglee" || e.status === "comptabilisee") ? (
                    <Act label="Marquer comme lu" onClick={() => change.mutate({ id: e.id, action: "mark_seen" })} />
                  ) : null}
                  {e.user_id === user?.id && (e.status === "brouillon" || e.status === "soumis" || e.status === "refuse") ? (
                    <Act label="Supprimer" onClick={() => remove.mutate(e.id)} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {perms.canValidateExpenses && scope === "to_validate" && (pending.data?.length ?? 0) > 0 ? (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Send className="h-3 w-3" /> L'envoi à la comptabilité n'a lieu qu'après validation.
        </p>
      ) : null}
    </AppShell>
  );
}

function Act({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase ${
        primary ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card"
      }`}
    >
      {label}
    </button>
  );
}
