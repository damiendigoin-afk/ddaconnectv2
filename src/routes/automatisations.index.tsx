import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, Section } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import { listJobs, listRuns, runJob, toggleJob, type AutomationJob } from "@/lib/automation";

export const Route = createFileRoute("/automatisations/")({
  head: () => ({
    meta: [
      { title: "Automatisations — Tâches planifiées — DDA Connect" },
      { name: "description", content: "Pilotage des tâches automatiques : purge des brouillons, détection des échéances et relève des boîtes mail." },
      { property: "og:title", content: "Automatisations — Tâches planifiées" },
      { property: "og:description", content: "Activation, exécution manuelle et journal des automatisations de l'atelier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutomationHub,
});

function AutomationHub() {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const jobs = useQuery({ queryKey: ["automation-jobs"], queryFn: listJobs, enabled: isManager });
  const runs = useQuery({ queryKey: ["automation-runs"], queryFn: listRuns, enabled: isManager });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleJob(id, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["automation-jobs"] }),
    onError: (e) => toastError(e, "Activation impossible"),
  });

  const run = useMutation({
    mutationFn: (job: AutomationJob) => runJob(job),
    onSuccess: (msg) => {
      toast.success(msg || "Automatisation exécutée");
      void qc.invalidateQueries({ queryKey: ["automation-jobs"] });
      void qc.invalidateQueries({ queryKey: ["automation-runs"] });
    },
    onError: (e) => toastError(e, "Exécution impossible"),
  });

  if (!isManager) {
    return (
      <AppShell title="Automatisations" back={{ to: "/" }}>
        <p className="rounded-xl border-2 border-border bg-card p-4 text-sm">
          Cet espace est réservé aux managers. Demandez à un manager de vous accorder le rôle si vous devez piloter les
          tâches automatiques.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Automatisations" subtitle="Tâches planifiées et journal d'exécution" back={{ to: "/" }}>
      <Section title="Tâches">
        <div className="space-y-2">
          {(jobs.data ?? []).map((j) => (
            <div key={j.id} className="rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-bold">{j.label}</span>
                <Badge tone={j.enabled ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground"}>
                  {j.enabled ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{j.description}</p>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Planification : {j.schedule ?? "manuelle"}
                {j.last_run_at ? ` · dernière exécution ${new Date(j.last_run_at).toLocaleString("fr-FR")}` : ""}
                {j.last_status ? ` (${j.last_status})` : ""}
              </div>
              {j.last_message ? <p className="mt-1 text-xs">{j.last_message}</p> : null}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => toggle.mutate({ id: j.id, enabled: !j.enabled })}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
                >
                  {j.enabled ? "Désactiver" : "Activer"}
                </button>
                <button
                  onClick={() => run.mutate(j)}
                  disabled={run.isPending}
                  className="flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[11px] font-bold uppercase text-brand-foreground disabled:opacity-60"
                >
                  <Play className="h-3 w-3" /> Exécuter
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Journal">
        {!(runs.data ?? []).length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune exécution enregistrée pour le moment.
          </p>
        ) : null}
        <div className="space-y-2">
          {(runs.data ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-2 text-xs">
              <span className="font-bold">{new Date(r.started_at).toLocaleString("fr-FR")}</span> · {r.status}
              {r.message ? ` — ${r.message}` : ""}
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}