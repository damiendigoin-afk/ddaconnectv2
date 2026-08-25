import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Section } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { alertLevel, fetchAiBudget, fetchAiCosts, saveAiBudget, type AiBudget } from "@/lib/ai-costs";

export const Route = createFileRoute("/parametrage/couts")({
  head: () => ({
    meta: [
      { title: "Coûts et IA — DDA Connect" },
      {
        name: "description",
        content:
          "Suivi des coûts d'analyse automatique DDA Connect : crédits consommés par jour, par fonction, cache, échecs facturés et budgets paramétrables.",
      },
      { property: "og:title", content: "Coûts et IA — DDA Connect" },
      { property: "og:description", content: "Journal des analyses automatiques et budgets IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostsPage,
});

const fmt = (n: number) => `${n.toFixed(2)} cr.`;

function CostsPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const costs = useQuery({ queryKey: ["ia", "couts"], queryFn: fetchAiCosts, enabled: isManager });
  const budget = useQuery({ queryKey: ["ia", "budget"], queryFn: fetchAiBudget, enabled: isManager });
  const [form, setForm] = useState<AiBudget | null>(null);

  useEffect(() => {
    if (budget.data && !form) setForm(budget.data);
  }, [budget.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      await saveAiBudget(form);
    },
    onSuccess: () => {
      toast.success("Budgets enregistrés");
      void qc.invalidateQueries({ queryKey: ["ia", "budget"] });
    },
    onError: () => toast.error("Enregistrement impossible."),
  });

  if (!isManager) {
    return (
      <AppShell title="Coûts et IA" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">
          Accès réservé aux managers.
        </p>
      </AppShell>
    );
  }

  const s = costs.data;
  const dayLevel = s && form ? alertLevel(s.today, form.daily_credits) : 0;
  const monthLevel = s && form ? alertLevel(s.month, form.monthly_credits) : 0;

  return (
    <AppShell title="Coûts et IA" subtitle="Analyses automatiques : consommation et budgets" back={{ to: "/parametrage" }}>
      <Section title="Consommation">
        {costs.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {s ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border-2 border-border bg-card p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Aujourd'hui
              </div>
              <div className="text-xl font-extrabold">{fmt(s.today)}</div>
              <div className="text-[11px] text-muted-foreground">
                {s.callsToday} appel(s) payant(s) · {s.cacheHitsToday} réutilisation(s) de cache ·{" "}
                {s.blockedToday} bloqué(s) · {s.failedBilledToday} échec(s) facturé(s)
              </div>
              {dayLevel >= 50 ? (
                <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                  Budget journalier atteint à {dayLevel} %.
                </div>
              ) : null}
            </div>
            <div className="rounded-xl border-2 border-border bg-card p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Mois en cours
              </div>
              <div className="text-xl font-extrabold">{fmt(s.month)}</div>
              {monthLevel >= 50 ? (
                <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                  Budget mensuel atteint à {monthLevel} %.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Par fonction (mois)">
        <div className="space-y-1">
          {(s?.byFeature ?? []).map((f) => (
            <div
              key={f.feature}
              className="flex items-center justify-between rounded-lg border border-border px-2 py-2 text-[12px]"
            >
              <span className="font-bold">{f.feature}</span>
              <span className="text-muted-foreground">
                {f.calls} op. · {f.cacheHits} cache · {fmt(f.credits)}
              </span>
            </div>
          ))}
          {!s?.byFeature.length ? (
            <p className="text-sm text-muted-foreground">Aucune analyse automatique ce mois-ci.</p>
          ) : null}
        </div>
      </Section>

      <Section title="Budgets">
        {form ? (
          <div className="space-y-2">
            {(
              [
                ["daily_credits", "Budget journalier (crédits)"],
                ["monthly_credits", "Budget mensuel (crédits)"],
                ["max_credits_per_operation", "Coût maximal par opération"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {label}
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={form.fallback_ai_enabled}
                onChange={(e) => setForm({ ...form, fallback_ai_enabled: e.target.checked })}
              />
              Autoriser le repli IA sur les documents non reconnus (désactivé par défaut)
            </label>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full rounded-xl bg-brand px-4 py-3 text-xs font-bold uppercase text-brand-foreground"
            >
              Enregistrer
            </button>
            <p className="text-[11px] text-muted-foreground">
              Une limite atteinte bloque uniquement l'analyse automatique : la saisie manuelle et les
              Tours restent disponibles.
            </p>
          </div>
        ) : null}
      </Section>

      <Section title="Dernières opérations">
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {(s?.rows ?? []).slice(0, 100).map((r) => (
            <div key={r.id} className="rounded-lg border border-border px-2 py-1.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{r.feature}</span>
                <span>{r.cache_hit ? "cache · 0 cr." : fmt(Number(r.estimated_credits))}</span>
              </div>
              <div className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString("fr-FR")} · {r.model ?? "—"} ·{" "}
                {r.tokens_in ?? 0}/{r.tokens_out ?? 0} tokens
                {r.http_status ? ` · HTTP ${r.http_status}` : ""}
                {r.blocked_reason ? ` · ${r.blocked_reason}` : ""}
                {r.success ? "" : " · échec"}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}
