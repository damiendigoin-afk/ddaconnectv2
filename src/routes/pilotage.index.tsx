import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter, Section } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import {
  AGE_BUCKETS,
  agedTotals,
  eur,
  fetchPilotage,
  fetchPlatformHealth,
  healthTone,
  listReceivables,
  variation,
  type Receivable,
} from "@/lib/pilotage";

export const Route = createFileRoute("/pilotage/")({
  head: () => ({
    meta: [
      { title: "Pilotage & recouvrement — DDA Connect" },
      {
        name: "description",
        content:
          "Balance âgée des créances carrosserie, comparaison Groupe année en cours vs N-1 et santé de la plateforme (volumes emails, stockage, automatisations).",
      },
      { property: "og:title", content: "Pilotage & recouvrement — DDA Connect" },
      { property: "og:description", content: "Créances par ancienneté, indicateurs N/N-1 et quotas plateforme." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PilotageHub,
});

type Tab = "recouvrement" | "groupe" | "sante";

function PilotageHub() {
  const { isManager } = useAuth();
  const { site, scope } = useSite();
  const siteId = scope === "groupe" ? null : (site?.id ?? null);
  const [tab, setTab] = useState<Tab>("recouvrement");
  const [bucket, setBucket] = useState<string>("");
  const year = new Date().getFullYear();

  const receivables = useQuery({ queryKey: ["pilotage", "receivables", siteId], queryFn: () => listReceivables(siteId) });
  const pilot = useQuery({ queryKey: ["pilotage", "groupe", year, siteId], queryFn: () => fetchPilotage(year, siteId), enabled: tab === "groupe" });
  const health = useQuery({ queryKey: ["pilotage", "sante"], queryFn: fetchPlatformHealth, enabled: tab === "sante" });

  const rows = receivables.data ?? [];
  const totals = useMemo(() => agedTotals(rows), [rows]);
  const visible = bucket ? rows.filter((r) => r.bucket === bucket) : rows;

  if (!isManager) {
    return (
      <AppShell title="Pilotage" subtitle="Réservé aux managers" back={{ to: "/" }}>
        <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
          Le pilotage, le recouvrement et la santé de la plateforme sont réservés aux managers.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Pilotage & recouvrement" subtitle={scope === "groupe" ? "Vue Groupe" : (site?.name ?? "Site")} back={{ to: "/" }}>
      <div className="grid grid-cols-3 gap-2">
        <Counter label="Encours" value={eur(totals.total)} active={tab === "recouvrement"} onClick={() => setTab("recouvrement")} />
        <Counter label={`Groupe ${year}/${year - 1}`} value="N/N-1" active={tab === "groupe"} onClick={() => setTab("groupe")} />
        <Counter label="Santé" value={health.data ? health.data.metrics.filter((m) => healthTone(m) !== "ok").length : "—"} active={tab === "sante"} onClick={() => setTab("sante")} />
      </div>

      {tab === "recouvrement" ? (
        <>
          <Section title="Balance âgée">
            <div className="grid grid-cols-4 gap-2">
              {AGE_BUCKETS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBucket((v) => (v === b ? "" : b))}
                  className={`rounded-xl border-2 px-2 py-3 text-left ${bucket === b ? "border-brand bg-brand/10" : "border-border bg-card"}`}
                >
                  <div className="text-sm font-extrabold leading-none">{eur(totals.byBucket[b])}</div>
                  <div className="mt-1 text-[11px] font-bold uppercase text-muted-foreground">{b} j</div>
                </button>
              ))}
            </div>
            {totals.byPayer.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {totals.byPayer.map((p) => (
                  <Badge key={p.key}>
                    {p.label} · {eur(p.outstanding)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title={`Créances ouvertes (${visible.length})`}>
            {!receivables.isLoading && !visible.length ? (
              <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
                Aucune créance en attente d'encaissement sur ce périmètre.
              </p>
            ) : null}
            <div className="space-y-2">
              {visible.map((r) => (
                <ReceivableCard key={r.case_id} row={r} />
              ))}
            </div>
          </Section>
        </>
      ) : null}

      {tab === "groupe" ? (
        <Section title={`Année ${year} vs ${year - 1}`}>
          {pilot.isLoading ? <p className="text-sm text-muted-foreground">Calcul en cours…</p> : null}
          <div className="space-y-2">
            {(pilot.data?.rows ?? []).map((r) => {
              const v = variation(r.current, r.previous);
              const fmt = (n: number) => (r.unit === "eur" ? eur(n) : String(n));
              return (
                <div key={r.key} className="rounded-xl border-2 border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-extrabold uppercase tracking-wide">{r.label}</span>
                    <span className={`text-sm font-extrabold ${v >= 0 ? "text-status-ok" : "text-status-alert"}`}>
                      {v >= 0 ? "+" : ""}
                      {v.toFixed(0)} %
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {year} : <strong className="text-foreground">{fmt(r.current)}</strong> · {year - 1} : {fmt(r.previous)}
                  </div>
                </div>
              );
            })}
          </div>
          {pilot.data ? (
            <div className="mt-3 rounded-xl border-2 border-border bg-card p-3">
              <div className="text-xs font-bold uppercase text-muted-foreground">CA carrosserie par mois</div>
              <div className="mt-2 space-y-1">
                {pilot.data.monthly.map((m) => {
                  const max = Math.max(1, ...pilot.data.monthly.flatMap((x) => [x.current, x.previous]));
                  return (
                    <div key={m.month} className="flex items-center gap-2">
                      <span className="w-6 text-[11px] font-bold text-muted-foreground">{String(m.month).padStart(2, "0")}</span>
                      <div className="flex-1 space-y-0.5">
                        <div className="h-2 rounded bg-brand" style={{ width: `${(m.current / max) * 100}%` }} />
                        <div className="h-2 rounded bg-secondary" style={{ width: `${(m.previous / max) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-[11px] text-muted-foreground">{eur(m.current)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {tab === "sante" ? (
        <Section title="Santé de la plateforme">
          {health.isLoading ? <p className="text-sm text-muted-foreground">Analyse en cours…</p> : null}
          <div className="space-y-2">
            {(health.data?.metrics ?? []).map((m) => {
              const tone = healthTone(m);
              const pct = m.quota ? Math.min(100, (m.value / m.quota) * 100) : 0;
              return (
                <div key={m.key} className="rounded-xl border-2 border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-extrabold uppercase tracking-wide">{m.label}</span>
                    <Badge
                      tone={
                        tone === "critique"
                          ? "bg-status-alert-soft text-status-alert"
                          : tone === "alerte"
                            ? "bg-status-watch-soft text-status-watch"
                            : "bg-secondary text-foreground"
                      }
                    >
                      {m.value}
                      {m.unit === "mo" ? " Mo" : ""}
                      {m.quota ? ` / ${m.quota}` : ""}
                    </Badge>
                  </div>
                  <div className="mt-2 h-2 rounded bg-secondary">
                    <div
                      className={`h-2 rounded ${tone === "critique" ? "bg-status-alert" : tone === "alerte" ? "bg-status-watch" : "bg-brand"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl border-2 border-border bg-card p-3 text-xs text-muted-foreground">
            Automatisations (30 j) : {health.data?.failedRuns ?? 0} exécution(s) en erreur
            {health.data?.lastRunAt ? ` · dernière le ${new Date(health.data.lastRunAt).toLocaleString("fr-FR")}` : ""}.{" "}
            <Link to="/automatisations" className="font-bold text-brand underline">
              Voir le détail
            </Link>
          </div>
        </Section>
      ) : null}
    </AppShell>
  );
}

function ReceivableCard({ row }: { row: Receivable }) {
  return (
    <Link
      to="/carrosserie/$caseId"
      params={{ caseId: row.case_id }}
      className="block rounded-xl border-2 border-border bg-card p-3 active:scale-[0.99]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-extrabold uppercase tracking-wide">{row.plate || row.or_number || "Dossier"}</span>
        <span className="text-sm font-extrabold">{eur(row.outstanding)}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {row.customer_name || "Client non renseigné"} · {row.days} j · attendu {eur(row.expected)} / encaissé {eur(row.received)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone={row.bucket === "90+" ? "bg-status-alert-soft text-status-alert" : row.bucket === "61-90" ? "bg-status-watch-soft text-status-watch" : "bg-secondary text-foreground"}>
          {row.bucket} j
        </Badge>
        {row.parts.map((p) => (
          <Badge key={p.key}>
            {p.label} {eur(p.outstanding)}
          </Badge>
        ))}
      </div>
    </Link>
  );
}
