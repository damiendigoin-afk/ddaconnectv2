import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Inbox, Link2, Mail, Paperclip, Plug, RefreshCw, Unlink, Users, Zap } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import { CATEGORY_LABELS, EMAIL_CATEGORIES } from "@/lib/emails-core";
import {
  computeStats,
  fetchEmailAccounts,
  fetchEmails,
  receivedByLabel,
  setAccountStatus,
  setTriageStatus,
  upsertEmailAccount,
  type EmailAccount,
  type EmailRow,
} from "@/lib/emails";
import {
  IMPORTANCE_LABELS,
  SERVICE_LABELS,
  TRIAGE_STATUS_LABELS,
  URGENCY_LABELS,
  type Importance,
  type Service,
  type TriageStatus,
  type Urgency,
} from "@/lib/triage-core";
import {
  disconnectGmail,
  getGmailAuthUrl,
  syncGmailAccount,
} from "@/lib/gmail.functions";

export const Route = createFileRoute("/emails/")({
  head: () => ({
    meta: [
      { title: "Flux emails — DDA Connect" },
      {
        name: "description",
        content:
          "Boîtes Gmail centralisées : un email unique par message, catégorisation automatique et recherche transverse.",
      },
      { property: "og:title", content: "Flux emails — DDA Connect" },
      { property: "og:description", content: "Centralisation et classement automatique des emails du groupe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmailsPage,
});

function EmailsPage() {
  const { isManager, loading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [mailbox, setMailbox] = useState("all");
  const [triage, setTriage] = useState("all");
  const [tab, setTab] = useState<"flux" | "boites">("flux");
  const [open, setOpen] = useState<string | null>(null);
  const [newBox, setNewBox] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("gmail_connected");
    const error = params.get("gmail_error");
    if (connected) {
      toast.success("Gmail connecté avec succès");
      window.history.replaceState({}, "", "/emails");
    } else if (error) {
      toastError(new Error(decodeURIComponent(error)), "Connexion Gmail échouée");
      window.history.replaceState({}, "", "/emails");
    }
  }, []);

  const accounts = useQuery({ queryKey: ["email-accounts"], queryFn: fetchEmailAccounts });
  const emails = useQuery({
    queryKey: ["emails", search, category, mailbox, triage],
    queryFn: () => fetchEmails({ search, category, mailbox, triage }),
  });

  const stats = useMemo(() => computeStats(emails.data ?? []), [emails.data]);

  const addBox = useMutation({
    mutationFn: (address: string) => upsertEmailAccount({ address }),
    onSuccess: async () => {
      setNewBox("");
      toast.success("Boîte ajoutée");
      await qc.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (e) => toastError(e, "Ajout de la boîte impossible"),
  });

  const toggle = useMutation({
    mutationFn: (a: { id: string; status: string }) => setAccountStatus(a.id, a.status),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["email-accounts"] }),
    onError: (e) => toastError(e, "Modification de la boîte impossible"),
  });

  const connectGmail = useMutation({
    mutationFn: async (accountId: string) => {
      const { url } = await getGmailAuthUrl({ data: { accountId, origin: window.location.origin } });
      window.location.href = url;
    },
    onError: (e) => toastError(e, "Connexion Gmail impossible"),
  });

  const syncGmail = useMutation({
    mutationFn: (accountId: string) => syncGmailAccount({ data: { accountId } }),
    onSuccess: async (res) => {
      toast.success(`${res.ingested} email(s) importé(s), ${res.duplicates} doublon(s)`);
      await qc.invalidateQueries({ queryKey: ["emails"] });
      await qc.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (e) => toastError(e, "Synchronisation Gmail impossible"),
  });

  const markTriage = useMutation({
    mutationFn: (a: { id: string; status: TriageStatus }) => setTriageStatus(a.id, a.status),
    onSuccess: async () => {
      toast.success("Suivi mis à jour");
      await qc.invalidateQueries({ queryKey: ["emails"] });
    },
    onError: (e) => toastError(e, "Mise à jour du suivi impossible"),
  });

  const disconnectGmailMut = useMutation({
    mutationFn: (accountId: string) => disconnectGmail({ data: { accountId } }),
    onSuccess: async () => {
      toast.success("Gmail déconnecté");
      await qc.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (e) => toastError(e, "Déconnexion Gmail impossible"),
  });

  if (loading) {
    return (
      <AppShell title="Flux emails" back={{ to: "/" }}>
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Flux emails" subtitle="Centralisation des boîtes" back={{ to: "/" }}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Aujourd'hui" value={stats.today} />
          <Kpi label="7 jours" value={stats.week} />
          <Kpi label="Classés" value={`${stats.classifiedRate} %`} />
        </div>

        <div className="flex gap-2">
          <Tab active={tab === "flux"} onClick={() => setTab("flux")} label="Flux" icon={<Inbox className="h-4 w-4" />} />
          <Tab
            active={tab === "boites"}
            onClick={() => setTab("boites")}
            label="Boîtes"
            icon={<Plug className="h-4 w-4" />}
          />
        </div>

        {tab === "flux" ? (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un expéditeur, un objet, un mot…"
              aria-label="Rechercher dans les emails"
              className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm outline-none focus:border-brand"
            />

            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip active={triage === "all"} onClick={() => setTriage("all")} label="Tout le flux" />
              <Chip active={triage === "a_faire"} onClick={() => setTriage("a_faire")} label="À traiter / action" />
              {(Object.keys(TRIAGE_STATUS_LABELS) as TriageStatus[]).map((st) => (
                <Chip key={st} active={triage === st} onClick={() => setTriage(st)} label={TRIAGE_STATUS_LABELS[st]} />
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip active={category === "all"} onClick={() => setCategory("all")} label="Toutes" />
              {EMAIL_CATEGORIES.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)} label={CATEGORY_LABELS[c]} />
              ))}
            </div>

            {stats.byMailbox.length ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Chip active={mailbox === "all"} onClick={() => setMailbox("all")} label="Toutes les boîtes" />
                {stats.byMailbox.map((b) => (
                  <Chip
                    key={b.mailbox}
                    active={mailbox === b.mailbox}
                    onClick={() => setMailbox(b.mailbox)}
                    label={`${b.mailbox} (${b.count})`}
                  />
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              {(emails.data ?? []).map((m) => (
                <EmailCard
                  key={m.id}
                  row={m}
                  open={open === m.id}
                  onToggle={() => setOpen((v) => (v === m.id ? null : m.id))}
                  onStatus={(status) => markTriage.mutate({ id: m.id, status })}
                />
              ))}
              {emails.data && !emails.data.length ? (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Aucun email. Connectez une boîte Gmail dans l'onglet « Boîtes » pour lancer la collecte.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {isManager ? (
              <div className="card-surface space-y-2 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Ajouter une boîte Gmail
                </div>
                <div className="flex gap-2">
                  <input
                    value={newBox}
                    onChange={(e) => setNewBox(e.target.value)}
                    placeholder="prenom@garagecastillon.fr"
                    aria-label="Adresse de la boîte à connecter"
                    className="flex-1 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => newBox.includes("@") && addBox.mutate(newBox)}
                    className="rounded-lg bg-brand px-4 py-2 text-xs font-extrabold uppercase text-brand-foreground"
                  >
                    Ajouter
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Chaque salarié autorisé connecte sa propre boîte. Un email reçu par plusieurs personnes reste une
                  seule entrée, avec la liste des destinataires internes.
                </p>
              </div>
            ) : null}

            {(accounts.data ?? []).map((a: EmailAccount) => (
              <div key={a.id} className="card-surface space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{a.address}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.gmail_connected
                        ? "Gmail connecté"
                        : a.status === "connected"
                          ? "Connectée"
                          : a.status === "error"
                            ? a.last_error ?? "Erreur"
                            : "En attente"}
                      {a.last_sync_at
                        ? ` · dernière collecte ${new Date(a.last_sync_at).toLocaleString("fr-FR")}`
                        : ""}
                    </div>
                  </div>
                </div>
                {isManager ? (
                  <div className="flex flex-wrap gap-2">
                    {a.gmail_connected ? (
                      <>
                        <button
                          onClick={() => syncGmail.mutate(a.id)}
                          disabled={syncGmail.isPending}
                          className="rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50"
                        >
                          <Zap className="mr-1 inline h-3 w-3" />
                          {syncGmail.isPending ? "Sync…" : "Synchroniser"}
                        </button>
                        <button
                          onClick={() => disconnectGmailMut.mutate(a.id)}
                          disabled={disconnectGmailMut.isPending}
                          className="rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
                        >
                          <Unlink className="mr-1 inline h-3 w-3" />
                          Déconnecter
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => connectGmail.mutate(a.id)}
                        disabled={connectGmail.isPending}
                        className="rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50"
                      >
                        <Link2 className="mr-1 inline h-3 w-3" />
                        {connectGmail.isPending ? "Redirection…" : "Connecter Gmail"}
                      </button>
                    )}
                    {!a.gmail_connected ? (
                      <button
                        onClick={() => toggle.mutate({ id: a.id, status: a.status === "connected" ? "paused" : "connected" })}
                        className="rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
                      >
                        <RefreshCw className="mr-1 inline h-3 w-3" />
                        {a.status === "connected" ? "Suspendre" : "Activer"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            {accounts.data && !accounts.data.length ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Aucune boîte connectée.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EmailCard({
  row,
  open,
  onToggle,
  onStatus,
}: {
  row: EmailRow;
  open: boolean;
  onToggle: () => void;
  onStatus: (status: TriageStatus) => void;
}) {
  const received = receivedByLabel(row);
  const services = (row.services ?? []) as Service[];
  const late = row.due_at ? new Date(row.due_at).getTime() < Date.now() : false;
  return (
    <div className="card-surface w-full space-y-1 p-4 text-left">
      <button type="button" onClick={onToggle} className="w-full space-y-1 text-left">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{row.subject || "(sans objet)"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.from_name ? `${row.from_name} · ` : ""}
            {row.from_address}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase">
          {CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ?? row.category}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{new Date(row.sent_at).toLocaleString("fr-FR")}</span>
        {row.kind !== "message" ? <span className="font-bold uppercase">{row.kind}</span> : null}
        {row.has_attachments ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" /> pièce jointe
          </span>
        ) : null}
        {received ? (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {received}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1 pt-1">
        <Tag label={IMPORTANCE_LABELS[row.importance as Importance] ?? row.importance} />
        <Tag label={URGENCY_LABELS[row.urgency as Urgency] ?? row.urgency} />
        <Tag label={TRIAGE_STATUS_LABELS[row.triage_status as TriageStatus] ?? row.triage_status} />
        {row.action_required ? <Tag label="Action requise" /> : null}
        {row.human_required ? <Tag label="Traitement humain" /> : null}
        <Tag label={`Confiance ${row.triage_confidence}`} />
        {services.map((sv) => (
          <Tag key={sv} label={SERVICE_LABELS[sv] ?? sv} />
        ))}
        {row.due_at ? (
          <Tag label={`${late ? "En retard depuis" : "À traiter avant"} ${new Date(row.due_at).toLocaleString("fr-FR")}`} />
        ) : null}
        {row.expires_at ? (
          <Tag label={`Expire le ${new Date(row.expires_at).toLocaleDateString("fr-FR")}`} />
        ) : null}
      </div>
        {open ? (
          <p className="whitespace-pre-wrap border-t border-border pt-2 text-xs">
            {row.body_text || row.snippet || "Contenu non disponible."}
          </p>
        ) : row.snippet ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{row.snippet}</p>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border pt-2">
          {row.triage_reason ? <p className="text-[11px] text-muted-foreground">{row.triage_reason}</p> : null}
          <div className="flex flex-wrap gap-2">
            {(["a_traiter", "en_cours", "traite", "sans_suite"] as TriageStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onStatus(st)}
                className="rounded-lg border-2 border-border px-3 py-2 text-[11px] font-bold uppercase"
              >
                {TRIAGE_STATUS_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
      {label}
    </span>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-surface p-3 text-center">
      <div className="text-lg font-extrabold">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase ${
        active ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
        active ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}
