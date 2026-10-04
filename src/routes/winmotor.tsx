import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Wifi } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Section } from "@/components/bits";
import { useSite } from "@/lib/site-context";
import { formatWorkshopDateTime as formatParis } from "@/lib/datetime";
import {
  COMMAND_LABELS,
  STATUS_LABELS,
  enqueueJob,
  fetchAgentStatus,
  fetchRecentJobs,
  fmtDuration,
  jobDurationMs,
  orView,
  pick,
  waitJob,
  type AgentJob,
} from "@/lib/winmotor-agent";

export const Route = createFileRoute("/winmotor")({
  head: () => ({
    meta: [
      { title: "WINmotor — agent local — DDA Connect" },
      { name: "description", content: "Pilotage de l'agent WINmotor local : statut, lecture d'OR et historique des requêtes." },
      { property: "og:title", content: "WINmotor — agent local — DDA Connect" },
      { property: "og:description", content: "Statut de l'agent, lecture d'OR WINmotor et historique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WinmotorPage,
});

const inputCls = "h-11 w-full rounded-lg border-2 border-border bg-card px-3 text-sm";
const btnPrimary = "h-11 rounded-lg bg-brand px-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50";
const btnGhost = "h-11 rounded-lg border-2 border-border bg-card px-4 text-sm font-bold uppercase disabled:opacity-50";

function WinmotorPage() {
  const { active, isGroup, label } = useSite();
  const siteId = !isGroup && active ? active : null;
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ["winmotor-agent", "status", siteId],
    queryFn: () => fetchAgentStatus(siteId!),
    enabled: !!siteId,
    refetchInterval: 15_000,
    retry: false,
  });
  const jobs = useQuery({
    queryKey: ["winmotor-agent", "jobs", siteId],
    queryFn: () => fetchRecentJobs(siteId!),
    enabled: !!siteId,
    refetchInterval: 15_000,
  });

  const [orNum, setOrNum] = useState("");
  const [orBusy, setOrBusy] = useState(false);
  const [orJob, setOrJob] = useState<AgentJob | null>(null);
  const [orErr, setOrErr] = useState<string | null>(null);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingMsg, setPingMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["winmotor-agent"] });

  async function readOr() {
    const n = orNum.trim();
    if (!siteId || !n || orBusy) return;
    setOrBusy(true);
    setOrErr(null);
    setOrJob(null);
    try {
      const id = await enqueueJob(siteId, "GET_OR", { or: n }, 10);
      refresh();
      const j = await waitJob(id, 90_000);
      setOrJob(j);
      if (j.status !== "succeeded") setOrErr(j.error || `Le job s'est terminé en « ${STATUS_LABELS[j.status] ?? j.status} ».`);
    } catch (e) {
      setOrErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOrBusy(false);
      refresh();
    }
  }

  async function ping() {
    if (!siteId || pingBusy) return;
    setPingBusy(true);
    setPingMsg(null);
    try {
      const id = await enqueueJob(siteId, "PING", {}, 10);
      refresh();
      const j = await waitJob(id, 45_000);
      if (j.status === "succeeded") {
        const extra = pick(j.result, "message", "version", "pong");
        setPingMsg({ ok: true, text: `Connexion OK (${fmtDuration(jobDurationMs(j))})${extra ? ` — ${extra}` : ""}` });
      } else setPingMsg({ ok: false, text: j.error || "Le test a échoué." });
    } catch (e) {
      setPingMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPingBusy(false);
      refresh();
    }
  }

  if (!siteId) {
    return (
      <AppShell title="WINmotor" subtitle="Agent local" back={{ to: "/atelier" }}>
        <p className="rounded-lg bg-status-watch-soft px-3 py-3 text-sm text-status-watch">
          Choisissez un site précis dans la barre du haut (la vue groupe n'est pas pilotable).
        </p>
      </AppShell>
    );
  }

  const st = status.data;
  const ls = (st?.last_status ?? {}) as Record<string, unknown>;
  const state = pick(ls, "state", "status", "etat");
  const version = pick(ls, "version", "agent_version");
  const view = orJob?.status === "succeeded" ? orView(orJob.result) : null;

  return (
    <AppShell title="WINmotor" subtitle={`Agent local — ${label}`} back={{ to: "/atelier" }}>
      <div className="grid gap-4 pt-2 lg:grid-cols-2">
        <Section title="Statut de l'agent">
          {status.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
          {status.error ? (
            <p className="rounded-lg bg-status-alert-soft px-3 py-2 text-sm text-status-alert">
              {(status.error as Error).message === "site access denied" ? "Vous n'avez pas accès à ce site." : (status.error as Error).message}
            </p>
          ) : null}
          {st ? (
            <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={st.online ? "bg-status-ok-soft text-status-ok" : "bg-status-alert-soft text-status-alert"}>
                  {st.online ? "En ligne" : "Hors ligne"}
                </Badge>
                {state ? <Badge tone="bg-secondary text-foreground">{state === "busy" ? "Occupé" : state === "idle" ? "Disponible" : state}</Badge> : null}
                {!st.configured ? <span className="text-xs text-muted-foreground">Aucun agent configuré pour ce site.</span> : null}
              </div>
              {st.name ? <Row k="Agent" v={st.name} /> : null}
              <Row k="Dernière présence" v={st.last_seen_at ? formatParis(st.last_seen_at) : null} />
              <Row k="Version" v={version} />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button className={btnGhost} onClick={ping} disabled={pingBusy}>
                  {pingBusy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Wifi className="mr-1 inline h-4 w-4" />}
                  Tester la connexion
                </button>
              </div>
              {pingMsg ? (
                <p className={`rounded-lg px-3 py-2 text-sm ${pingMsg.ok ? "bg-status-ok-soft text-status-ok" : "bg-status-alert-soft text-status-alert"}`} role="status">
                  {pingMsg.text}
                </p>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="Lire un OR">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void readOr();
            }}
          >
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder="Numéro OR (ex. 50888)"
              value={orNum}
              onChange={(e) => setOrNum(e.target.value)}
              aria-label="Numéro OR"
            />
            <button className={`${btnPrimary} shrink-0`} type="submit" disabled={orBusy || !orNum.trim()}>
              {orBusy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
              Lire dans WINmotor
            </button>
          </form>
          {orBusy ? <p className="mt-2 text-sm text-muted-foreground">Lecture en cours dans WINmotor…</p> : null}
          {orErr ? (
            <p className="mt-2 rounded-lg bg-status-alert-soft px-3 py-2 text-sm text-status-alert" role="alert">
              {orErr}
            </p>
          ) : null}
          {view ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-extrabold uppercase">OR {view.or ?? orNum.trim()}</p>
              <Block title="Client" rows={view.client} />
              <Block title="Véhicule" rows={view.vehicle} />
            </div>
          ) : null}
        </Section>
      </div>

      <Section title="10 derniers jobs">
        <div className="space-y-2">
          {(jobs.data ?? []).length === 0 && !jobs.isLoading ? <p className="text-sm text-muted-foreground">Aucun job pour ce site.</p> : null}
          {(jobs.data ?? []).map((j) => (
            <div key={j.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {COMMAND_LABELS[j.command] ?? j.command}
                  {pick(j.payload, "or") ? ` · OR ${pick(j.payload, "or")}` : ""}
                </span>
                <Badge
                  tone={
                    j.status === "succeeded"
                      ? "bg-status-ok-soft text-status-ok"
                      : j.status === "failed"
                        ? "bg-status-alert-soft text-status-alert"
                        : "bg-secondary text-foreground"
                  }
                >
                  {STATUS_LABELS[j.status] ?? j.status}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatParis(j.created_at)} · durée {fmtDuration(jobDurationMs(j))}
              </div>
              {j.error ? <div className="mt-1 text-xs text-status-alert">{j.error}</div> : null}
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-semibold break-all">{v || "—"}</span>
    </div>
  );
}

function Block({ title, rows }: { title: string; rows: { label: string; value: string | null }[] }) {
  return (
    <div className="rounded-xl border-2 border-border bg-card p-3 text-sm">
      <div className="mb-1 text-xs font-extrabold uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-6">
        {rows.map((r) => (
          <Row key={r.label} k={r.label} v={r.value} />
        ))}
      </div>
    </div>
  );
}
