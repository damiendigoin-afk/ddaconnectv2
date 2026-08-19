import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Counter, Field, Section, Select } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { toastError } from "@/lib/errors";
import { fetchUsers } from "@/lib/users";
import {
  addNote,
  assignRequest,
  closeRequest,
  createRequest,
  CRM_CHANNELS,
  CRM_OUTCOMES,
  CRM_PRIORITIES,
  CRM_STATUSES,
  deleteRequest,
  escalateStale,
  ESCALATION_LABELS,
  isOverdue,
  listEvents,
  listRequests,
  setStatus,
  statusTone,
  type CrmRequest,
} from "@/lib/crm";

export const Route = createFileRoute("/crm/")({
  head: () => ({
    meta: [
      { title: "CRM — Demandes clients et escalade — DDA Connect" },
      {
        name: "description",
        content:
          "Suivi des demandes clients du garage : assignation d'un responsable, relances automatiques, escalade vers les collègues puis le manager, et issue enregistrée à la clôture.",
      },
      { property: "og:title", content: "CRM — Demandes clients et escalade" },
      { property: "og:description", content: "Demandes clients, responsables, relances et issues enregistrées." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrmHub,
});

const EMPTY = {
  channel: "telephone",
  priority: "normale",
  subject: "",
  body: "",
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  plate: "",
};

function CrmHub() {
  const qc = useQueryClient();
  const { user, displayName, isManager } = useAuth();
  const { site } = useSite();
  const [scope, setScope] = useState<"open" | "mine" | "all">("open");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);

  const actor = { id: user?.id ?? null, name: displayName || null };

  const rows = useQuery({
    queryKey: ["crm", scope, user?.id],
    queryFn: () => listRequests(scope, user?.id ?? null),
    enabled: !!user,
  });
  const users = useQuery({ queryKey: ["crm-users"], queryFn: fetchUsers, enabled: !!user });
  const list = rows.data ?? [];
  const late = useMemo(() => list.filter(isOverdue).length, [list]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["crm"] });

  const create = useMutation({
    mutationFn: () =>
      createRequest(
        {
          site_id: site?.id ?? null,
          channel: form.channel,
          priority: form.priority,
          subject: form.subject.trim(),
          body: form.body || null,
          customer_name: form.customer_name || null,
          customer_phone: form.customer_phone || null,
          customer_email: form.customer_email || null,
          plate: form.plate ? form.plate.toUpperCase() : null,
          assignee_id: user?.id ?? null,
          assignee_name: displayName || null,
        },
        actor,
      ),
    onSuccess: () => {
      toast.success("Demande enregistrée");
      setOpen(false);
      setForm(EMPTY);
      invalidate();
    },
    onError: (e) => toastError(e, "Enregistrement de la demande impossible"),
  });

  const escalate = useMutation({
    mutationFn: escalateStale,
    onSuccess: (n) => {
      toast.success(n ? `${n} demande(s) escaladée(s)` : "Aucune demande en retard");
      invalidate();
    },
    onError: (e) => toastError(e, "Escalade impossible"),
  });

  return (
    <AppShell
      title="CRM"
      subtitle="Demandes clients et relances"
      back={{ to: "/" }}
      right={
        <button onClick={() => setOpen((v) => !v)} aria-label="Nouvelle demande" className="rounded-lg bg-brand px-3 py-2 text-brand-foreground">
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Counter label="À traiter" value={scope === "open" ? list.length : "—"} active={scope === "open"} onClick={() => setScope("open")} />
        <Counter label="Les miennes" value={scope === "mine" ? list.length : "—"} active={scope === "mine"} onClick={() => setScope("mine")} />
        <Counter label="Toutes" value={scope === "all" ? list.length : "—"} active={scope === "all"} onClick={() => setScope("all")} />
      </div>

      {late ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-status-watch/40 bg-status-watch-soft p-3 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-status-watch" />
          <span className="flex-1">
            {late} demande(s) hors délai. L'escalade prévient le responsable, puis les collègues, puis le manager.
          </span>
          <button
            onClick={() => escalate.mutate()}
            disabled={escalate.isPending}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground disabled:opacity-60"
          >
            Escalader
          </button>
        </div>
      ) : null}

      {open ? (
        <Section title="Nouvelle demande">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <Field label="Objet" value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} placeholder="Rappel client, devis, réclamation…" />
            <Select label="Canal" value={form.channel} onChange={(v) => setForm({ ...form, channel: v })} options={CRM_CHANNELS} allowEmpty={false} />
            <Select label="Priorité" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={CRM_PRIORITIES} allowEmpty={false} />
            <Field label="Client" value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} />
            <Field label="Téléphone" value={form.customer_phone} onChange={(v) => setForm({ ...form, customer_phone: v })} />
            <Field label="Email" value={form.customer_email} onChange={(v) => setForm({ ...form, customer_email: v })} />
            <Field label="Immatriculation" value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} />
            <Area label="Détail de la demande" value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !form.subject.trim()}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              Enregistrer la demande
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`Demandes (${list.length})`}>
        {!rows.isLoading && !list.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune demande. Enregistrez les appels, emails et passages comptoir pour suivre les relances.
          </p>
        ) : null}
        <div className="space-y-2">
          {list.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              expanded={selected === r.id}
              onToggle={() => setSelected(selected === r.id ? null : r.id)}
              users={(users.data ?? []).map((u) => ({
                id: u.id,
                name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "Utilisateur",
              }))}
              actor={actor}
              isManager={isManager}
              onChanged={invalidate}
            />
          ))}
        </div>
      </Section>
    </AppShell>
  );
}

function RequestCard({
  request,
  expanded,
  onToggle,
  users,
  actor,
  isManager,
  onChanged,
}: {
  request: CrmRequest;
  expanded: boolean;
  onToggle: () => void;
  users: { id: string; name: string }[];
  actor: { id: string | null; name: string | null };
  isManager: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  const events = useQuery({
    queryKey: ["crm-events", request.id],
    queryFn: () => listEvents(request.id),
    enabled: expanded,
  });
  const refresh = () => {
    onChanged();
    void qc.invalidateQueries({ queryKey: ["crm-events", request.id] });
  };

  const act = useMutation({
    mutationFn: async (action: { type: string; value?: string }) => {
      if (action.type === "note") await addNote(request.id, note.trim(), actor);
      else if (action.type === "status") await setStatus(request.id, action.value!, actor);
      else if (action.type === "assign") {
        const u = users.find((x) => x.id === action.value);
        if (!u) throw new Error("Sélectionnez un responsable.");
        await assignRequest(request.id, u, actor);
      } else if (action.type === "close") await closeRequest(request.id, outcome, outcomeNote, actor);
      else if (action.type === "delete") await deleteRequest(request.id);
    },
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: (e) => toastError(e, "Action impossible sur la demande"),
  });

  const overdue = isOverdue(request);

  return (
    <div className={`rounded-xl border-2 bg-card p-3 ${overdue ? "border-status-watch/50" : "border-border"}`}>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(request.status)}>{CRM_STATUSES.find((s) => s.key === request.status)?.label ?? request.status}</Badge>
          <Badge>{CRM_PRIORITIES.find((p) => p.key === request.priority)?.label ?? request.priority}</Badge>
          {request.escalation_level > 0 ? (
            <Badge tone="bg-status-watch-soft text-status-watch">{ESCALATION_LABELS[request.escalation_level]}</Badge>
          ) : null}
        </div>
        <div className="mt-1 text-sm font-extrabold">{request.subject}</div>
        <div className="text-xs text-muted-foreground">
          {request.customer_name ?? "Client non renseigné"}
          {request.plate ? ` · ${request.plate}` : ""}
          {request.assignee_name ? ` · ${request.assignee_name}` : " · non assignée"}
          {request.due_at ? ` · échéance ${new Date(request.due_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}
        </div>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t-2 border-border pt-3">
          {request.body ? <p className="whitespace-pre-wrap text-sm">{request.body}</p> : null}
          {request.customer_phone || request.customer_email ? (
            <p className="text-xs text-muted-foreground">
              {request.customer_phone ?? ""} {request.customer_email ?? ""}
            </p>
          ) : null}

          {request.status !== "cloturee" ? (
            <>
              <Select
                label="Responsable"
                value={request.assignee_id ?? ""}
                onChange={(v) => act.mutate({ type: "assign", value: v })}
                options={users.map((u) => ({ key: u.id, label: u.name }))}
              />
              <div className="flex flex-wrap gap-2">
                {CRM_STATUSES.filter((s) => s.key !== "cloturee" && s.key !== request.status).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => act.mutate({ type: "status", value: s.key })}
                    className="rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <Area label="Ajouter un suivi" value={note} onChange={setNote} rows={2} />
              <button
                onClick={() => act.mutate({ type: "note" })}
                disabled={!note.trim() || act.isPending}
                className="w-full rounded-lg border-2 border-border py-2 text-xs font-bold uppercase disabled:opacity-60"
              >
                Enregistrer le suivi
              </button>

              <div className="rounded-lg border-2 border-dashed border-border p-3">
                <Select label="Issue de la demande" value={outcome} onChange={setOutcome} options={CRM_OUTCOMES} />
                <div className="mt-2">
                  <Area label="Précision" value={outcomeNote} onChange={setOutcomeNote} rows={2} />
                </div>
                <button
                  onClick={() => act.mutate({ type: "close" })}
                  disabled={!outcome || act.isPending}
                  className="mt-2 w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
                >
                  Clôturer avec cette issue
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm">
              <span className="font-bold">Issue : </span>
              {CRM_OUTCOMES.find((o) => o.key === request.outcome)?.label ?? request.outcome}
              {request.outcome_note ? ` — ${request.outcome_note}` : ""}
            </p>
          )}

          <div>
            <div className="mb-1 text-xs font-bold uppercase text-muted-foreground">Historique</div>
            <ul className="space-y-1">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {e.message}
                  {e.actor_name ? ` (${e.actor_name})` : ""}
                </li>
              ))}
              {!events.isLoading && !(events.data ?? []).length ? <li className="text-xs text-muted-foreground">Aucun événement.</li> : null}
            </ul>
          </div>

          {isManager ? (
            <button
              onClick={() => act.mutate({ type: "delete" })}
              className="w-full rounded-lg border-2 border-status-watch/50 py-2 text-xs font-bold uppercase text-status-watch"
            >
              Supprimer la demande
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}