import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter, Section } from "@/components/bits";
import { toastError } from "@/lib/errors";
import { ALERT_TYPES, listAlerts, rebuildPredictions, riskTone, setAlertStatus } from "@/lib/maintenance";

export const Route = createFileRoute("/maintenance/")({
  head: () => ({
    meta: [
      { title: "Maintenance prédictive — Échéances véhicules — DDA Connect" },
      { name: "description", content: "Anticipez révisions, distributions et contrôles techniques à partir des kilométrages relevés en atelier." },
      { property: "og:title", content: "Maintenance prédictive — Échéances véhicules" },
      { property: "og:description", content: "Projection des prochaines échéances d'entretien par véhicule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MaintenanceHub,
});

function MaintenanceHub() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["maintenance"], queryFn: listAlerts });
  const [risk, setRisk] = useState("");

  const list = (rows.data ?? []).filter((a) => a.status === "ouverte");
  const visible = useMemo(() => (risk ? list.filter((a) => a.risk === risk) : list), [list, risk]);

  const rebuild = useMutation({
    mutationFn: () => rebuildPredictions(),
    onSuccess: (n) => {
      toast.success(`${n} échéance(s) recalculée(s)`);
      void qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e) => toastError(e, "Recalcul des échéances impossible"),
  });

  const close = useMutation({
    mutationFn: (id: string) => setAlertStatus(id, "traitee"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance"] }),
    onError: (e) => toastError(e, "Mise à jour impossible"),
  });

  return (
    <AppShell
      title="Maintenance prédictive"
      subtitle="Échéances projetées par véhicule"
      back={{ to: "/" }}
      right={
        <button
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          aria-label="Recalculer les échéances"
          className="rounded-lg bg-brand px-3 py-2 text-brand-foreground disabled:opacity-60"
        >
          <RefreshCw className={`h-5 w-5 ${rebuild.isPending ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {["eleve", "moyen", "faible"].map((r) => (
          <Counter
            key={r}
            label={r === "eleve" ? "Risque élevé" : r === "moyen" ? "Risque moyen" : "Risque faible"}
            value={list.filter((a) => a.risk === r).length}
            active={risk === r}
            onClick={() => setRisk(risk === r ? "" : r)}
          />
        ))}
      </div>

      <Section title={`Échéances (${visible.length})`}>
        {rows.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!rows.isLoading && !visible.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune échéance calculée. Lancez le recalcul : il utilise les kilométrages relevés lors des tours véhicule et
            des expertises pour projeter les prochaines révisions.
          </p>
        ) : null}
        <div className="space-y-2">
          {visible.map((a) => (
            <div key={a.id} className="rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Badge tone={riskTone(a.risk)}>{a.risk}</Badge>
                <Badge>{ALERT_TYPES.find((t) => t.key === a.alert_type)?.label ?? a.alert_type}</Badge>
                <span className="ml-auto text-xs font-bold">
                  {a.due_date ? new Date(a.due_date).toLocaleDateString("fr-FR") : "—"}
                </span>
              </div>
              <div className="mt-2 text-sm font-bold">{a.plate ?? "Véhicule sans immatriculation"}</div>
              <div className="text-xs text-muted-foreground">
                {a.last_km != null ? `${a.last_km.toLocaleString("fr-FR")} km relevés` : "Kilométrage inconnu"}
                {a.km_per_month ? ` · ${a.km_per_month.toLocaleString("fr-FR")} km/mois` : ""}
                {a.due_km ? ` · échéance ${a.due_km.toLocaleString("fr-FR")} km` : ""}
              </div>
              <button
                onClick={() => close.mutate(a.id)}
                className="mt-2 rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
              >
                Marquer traitée
              </button>
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}