import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Counter, Field, Section, Select } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { toastError } from "@/lib/errors";
import {
  createExpense,
  deleteExpense,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS,
  listExpenses,
  setExpenseStatus,
  statusTone,
} from "@/lib/expenses";

export const Route = createFileRoute("/notes-frais/")({
  head: () => ({
    meta: [
      { title: "Notes de frais — Saisie et validation — DDA Connect" },
      { name: "description", content: "Saisie des dépenses professionnelles, suivi des montants et validation par le manager." },
      { property: "og:title", content: "Notes de frais — Saisie et validation" },
      { property: "og:description", content: "Dépenses, justificatifs et circuit de validation des notes de frais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpenseHub,
});

function ExpenseHub() {
  const qc = useQueryClient();
  const { user, displayName, isManager } = useAuth();
  const { site } = useSite();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ spent_on: new Date().toISOString().slice(0, 10), category: "carburant", merchant: "", amount_ttc: "", vat_amount: "", notes: "" });

  const rows = useQuery({
    queryKey: ["expenses", scope, user?.id],
    queryFn: () => listExpenses(scope, user?.id ?? null),
    enabled: !!user,
  });
  const list = rows.data ?? [];
  const total = useMemo(() => list.reduce((s, e) => s + Number(e.amount_ttc || 0), 0), [list]);

  const create = useMutation({
    mutationFn: () =>
      createExpense({
        user_id: user!.id,
        user_name: displayName || null,
        site_id: site?.id ?? null,
        spent_on: form.spent_on,
        category: form.category,
        merchant: form.merchant || null,
        amount_ttc: Number(form.amount_ttc || 0),
        vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        notes: form.notes || null,
        status: "brouillon",
      }),
    onSuccess: () => {
      toast.success("Note de frais enregistrée");
      setOpen(false);
      setForm({ spent_on: new Date().toISOString().slice(0, 10), category: "carburant", merchant: "", amount_ttc: "", vat_amount: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toastError(e, "Enregistrement de la note impossible"),
  });

  const change = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason?: string }) => setExpenseStatus(id, status, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (e) => toastError(e, "Changement de statut impossible"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (e) => toastError(e, "Suppression impossible"),
  });

  return (
    <AppShell
      title="Notes de frais"
      subtitle={scope === "mine" ? "Mes dépenses" : "Toutes les dépenses"}
      back={{ to: "/" }}
      right={
        <button onClick={() => setOpen((v) => !v)} aria-label="Nouvelle note" className="rounded-lg bg-brand px-3 py-2 text-brand-foreground">
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      {isManager ? (
        <div className="grid grid-cols-2 gap-2">
          <Counter label="Mes notes" value={scope === "mine" ? list.length : "—"} active={scope === "mine"} onClick={() => setScope("mine")} />
          <Counter label="Équipe" value={scope === "all" ? list.length : "—"} active={scope === "all"} onClick={() => setScope("all")} />
        </div>
      ) : null}

      <div className="mt-2 rounded-xl border-2 border-border bg-card p-3">
        <div className="text-2xl font-extrabold">{total.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
        <div className="text-[11px] font-bold uppercase text-muted-foreground">Total affiché</div>
      </div>

      {open ? (
        <Section title="Nouvelle note">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <Field label="Date" type="date" value={form.spent_on} onChange={(v) => setForm({ ...form, spent_on: v })} />
            <Select label="Catégorie" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={EXPENSE_CATEGORIES} allowEmpty={false} />
            <Field label="Commerçant" value={form.merchant} onChange={(v) => setForm({ ...form, merchant: v })} />
            <Field label="Montant TTC (€)" type="number" value={form.amount_ttc} onChange={(v) => setForm({ ...form, amount_ttc: v })} />
            <Field label="Dont TVA (€)" type="number" value={form.vat_amount} onChange={(v) => setForm({ ...form, vat_amount: v })} />
            <Area label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !form.amount_ttc}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              Enregistrer
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`Notes (${list.length})`}>
        {!rows.isLoading && !list.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune note de frais. Ajoutez vos dépenses professionnelles puis soumettez-les à validation.
          </p>
        ) : null}
        <div className="space-y-2">
          {list.map((e) => (
            <div key={e.id} className="rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(e.status)}>{EXPENSE_STATUS.find((s) => s.key === e.status)?.label ?? e.status}</Badge>
                <Badge>{EXPENSE_CATEGORIES.find((c) => c.key === e.category)?.label ?? e.category}</Badge>
                <span className="ml-auto text-sm font-extrabold">
                  {Number(e.amount_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(e.spent_on).toLocaleDateString("fr-FR")}
                {e.merchant ? ` · ${e.merchant}` : ""}
                {scope === "all" && e.user_name ? ` · ${e.user_name}` : ""}
              </div>
              {e.reject_reason ? <p className="mt-1 text-xs text-status-watch">Refus : {e.reject_reason}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {e.status === "brouillon" ? (
                  <button onClick={() => change.mutate({ id: e.id, status: "soumis" })} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase">
                    Soumettre
                  </button>
                ) : null}
                {isManager && e.status === "soumis" ? (
                  <>
                    <button onClick={() => change.mutate({ id: e.id, status: "valide" })} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase">
                      Valider
                    </button>
                    <button
                      onClick={() => {
                        const reason = window.prompt("Motif du refus ?") ?? "";
                        if (reason) change.mutate({ id: e.id, status: "refuse", reason });
                      }}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
                    >
                      Refuser
                    </button>
                  </>
                ) : null}
                {e.status === "brouillon" || isManager ? (
                  <button onClick={() => remove.mutate(e.id)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground">
                    Supprimer
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}