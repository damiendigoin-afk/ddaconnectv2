import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter, Section } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import {
  classifyInboxDoc,
  findCustomerDuplicates,
  findVehicleDuplicates,
  listInbox,
  listMerges,
  mergeCustomers,
  mergeVehicles,
  reopenInboxDoc,
  type DuplicateGroup,
} from "@/lib/quality";
import { openDoc } from "@/lib/documents";

export const Route = createFileRoute("/qualite/")({
  head: () => ({
    meta: [
      { title: "Qualité des données — Doublons et documents à classer — DDA Connect" },
      {
        name: "description",
        content:
          "Fusion des fiches clients et véhicules en doublon, journal des fusions et file des documents scannés restant à rattacher à un dossier.",
      },
      { property: "og:title", content: "Qualité des données — DDA Connect" },
      { property: "og:description", content: "Doublons clients/véhicules, fusions tracées et documents à classer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QualityHub,
});

type Tab = "doublons" | "aclasser" | "fusions";

function QualityHub() {
  const qc = useQueryClient();
  const { user, displayName, isManager } = useAuth();
  const [tab, setTab] = useState<Tab>("doublons");

  const dupes = useQuery({
    queryKey: ["quality", "dupes"],
    queryFn: async () => [...(await findVehicleDuplicates()), ...(await findCustomerDuplicates())],
    enabled: isManager,
  });
  const inbox = useQuery({ queryKey: ["quality", "inbox"], queryFn: () => listInbox("all") });
  const merges = useQuery({ queryKey: ["quality", "merges"], queryFn: () => listMerges(), enabled: isManager });

  const actor = { id: user?.id ?? null, name: displayName || null };

  const merge = useMutation({
    mutationFn: ({ group, keptId, mergedId }: { group: DuplicateGroup; keptId: string; mergedId: string }) =>
      group.kind === "vehicle" ? mergeVehicles(keptId, mergedId, actor, group.reason) : mergeCustomers(keptId, mergedId, actor, group.reason),
    onSuccess: () => {
      toast.success("Fiches fusionnées");
      void qc.invalidateQueries({ queryKey: ["quality"] });
    },
    onError: (e) => toastError(e, "Fusion impossible"),
  });

  const classify = useMutation({
    mutationFn: ({ id, kind, note }: { id: string; kind: string; note: string }) =>
      classifyInboxDoc(id, { kind, id: null, note }, actor),
    onSuccess: () => {
      toast.success("Document classé");
      void qc.invalidateQueries({ queryKey: ["quality", "inbox"] });
    },
    onError: (e) => toastError(e, "Classement impossible"),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => reopenInboxDoc(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["quality", "inbox"] }),
    onError: (e) => toastError(e, "Remise à classer impossible"),
  });

  const groups = dupes.data ?? [];
  const inboxAll = inbox.data ?? [];
  const toFile = inboxAll.filter((d) => d.status === "a_classer");

  if (!isManager) {
    return (
      <AppShell title="Qualité des données" subtitle="Documents à classer" back={{ to: "/" }}>
        <InboxList docs={toFile} onClassify={(id, kind, note) => classify.mutate({ id, kind, note })} onReopen={() => undefined} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Qualité des données" subtitle="Doublons, fusions et documents à classer" back={{ to: "/" }}>
      <div className="grid grid-cols-3 gap-2">
        <Counter label="Doublons" value={groups.length} active={tab === "doublons"} onClick={() => setTab("doublons")} />
        <Counter label="À classer" value={toFile.length} active={tab === "aclasser"} onClick={() => setTab("aclasser")} />
        <Counter label="Fusions" value={(merges.data ?? []).length} active={tab === "fusions"} onClick={() => setTab("fusions")} />
      </div>

      {tab === "doublons" ? (
        <Section title={`Doublons détectés (${groups.length})`}>
          {!dupes.isLoading && !groups.length ? (
            <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
              Aucun doublon détecté sur les immatriculations, les VIN ou les noms clients.
            </p>
          ) : null}
          <div className="space-y-2">
            {groups.map((g) => {
              const best = [...g.items].sort((a, b) => b.completeness - a.completeness || a.created_at.localeCompare(b.created_at))[0];
              return (
                <div key={`${g.kind}-${g.reason}-${g.key}`} className="rounded-xl border-2 border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <Badge>{g.kind === "vehicle" ? "Véhicule" : "Client"}</Badge>
                    <span className="text-xs font-bold uppercase text-muted-foreground">{g.reason}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {g.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-2">
                        <div className="flex-1">
                          <div className="text-sm font-extrabold">{it.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {it.detail}
                            {g.kind === "vehicle" ? ` · complète à ${it.completeness} %` : ""}
                            {best && it.id === best.id ? " · fiche conservée" : ""}
                          </div>
                        </div>
                        {best && it.id !== best.id ? (
                          <button
                            onClick={() => merge.mutate({ group: g, keptId: best.id, mergedId: it.id })}
                            disabled={merge.isPending}
                            className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase disabled:opacity-60"
                          >
                            Fusionner
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    La fusion complète uniquement les champs vides de la fiche conservée : aucune donnée renseignée n'est écrasée.
                  </p>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {tab === "aclasser" ? (
        <InboxList
          docs={inboxAll}
          onClassify={(id, kind, note) => classify.mutate({ id, kind, note })}
          onReopen={(id) => reopen.mutate(id)}
        />
      ) : null}

      {tab === "fusions" ? (
        <Section title="Journal des fusions">
          {!(merges.data ?? []).length ? (
            <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
              Aucune fusion enregistrée pour l'instant.
            </p>
          ) : null}
          <div className="space-y-2">
            {(merges.data ?? []).map((m) => (
              <div key={m.id} className="rounded-xl border-2 border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge>{m.entity_kind === "vehicle" ? "Véhicule" : "Client"}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("fr-FR")}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Conservée {m.kept_id.slice(0, 8)} · fusionnée {m.merged_id.slice(0, 8)}
                  {m.actor_name ? ` · ${m.actor_name}` : ""}
                </div>
                {m.reason ? <div className="text-xs">{m.reason}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </AppShell>
  );
}

const LINK_KINDS = [
  { key: "vehicule", label: "Véhicule" },
  { key: "client", label: "Client" },
  { key: "or", label: "OR" },
  { key: "sinistre", label: "Sinistre" },
  { key: "autre", label: "Autre" },
];

function InboxList({
  docs,
  onClassify,
  onReopen,
}: {
  docs: { id: string; file_name: string; storage_path: string; doc_type: string | null; confidence: number | null; plate: string | null; customer_name: string | null; status: string; note: string | null; created_at: string }[];
  onClassify: (id: string, kind: string, note: string) => void;
  onReopen: (id: string) => void;
}) {
  return (
    <Section title={`Documents (${docs.length})`}>
      {!docs.length ? (
        <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucun document en attente. Les documents scannés dont le dossier n'est pas retrouvé automatiquement arrivent ici, jamais perdus.
        </p>
      ) : null}
      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="rounded-xl border-2 border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Badge tone={d.status === "classe" ? "bg-secondary text-muted-foreground" : "bg-status-watch-soft text-status-watch"}>
                {d.status === "classe" ? "Classé" : "À classer"}
              </Badge>
              {d.doc_type ? <Badge>{d.doc_type}</Badge> : null}
              {d.confidence != null ? (
                <span className="text-[11px] text-muted-foreground">confiance {Math.round(Number(d.confidence) * 100)} %</span>
              ) : null}
            </div>
            <button onClick={() => void openDoc(d.storage_path)} className="mt-1 block text-left text-sm font-extrabold underline">
              {d.file_name}
            </button>
            <div className="text-[11px] text-muted-foreground">
              {new Date(d.created_at).toLocaleString("fr-FR")}
              {d.plate ? ` · ${d.plate}` : ""}
              {d.customer_name ? ` · ${d.customer_name}` : ""}
            </div>
            {d.note ? <div className="mt-1 text-xs">{d.note}</div> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {d.status === "a_classer" ? (
                LINK_KINDS.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => {
                      const note = window.prompt(`Rattacher à un ${k.label.toLowerCase()} — précisez la référence (immat, n° OR, nom…)`) ?? "";
                      if (note) onClassify(d.id, k.key, note);
                    }}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
                  >
                    {k.label}
                  </button>
                ))
              ) : (
                <button onClick={() => onReopen(d.id)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground">
                  Remettre à classer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
