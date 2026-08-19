import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Counter, Field, Section, Select } from "@/components/bits";
import { toastError } from "@/lib/errors";
import {
  createDarva,
  DARVA_STATUS,
  DARVA_TYPES,
  darvaLabel,
  darvaTone,
  listDarva,
  updateDarvaStatus,
} from "@/lib/darva";

export const Route = createFileRoute("/darva/")({
  head: () => ({
    meta: [
      { title: "Gestion DARVA — Échanges assureurs — DDA Connect" },
      { name: "description", content: "Suivi des missions, rapports, accords et règlements échangés avec les assureurs via DARVA." },
      { property: "og:title", content: "Gestion DARVA — Échanges assureurs" },
      { property: "og:description", content: "Missions, accords, factures et règlements assureurs centralisés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DarvaHub,
});

function DarvaHub() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["darva"], queryFn: listDarva });
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    reference: "",
    claim_ref: "",
    insurer: "",
    plate: "",
    message_type: "mission",
    direction: "in",
    amount: "",
    notes: "",
  });

  const list = rows.data ?? [];
  const visible = useMemo(() => (filter ? list.filter((r) => r.status === filter) : list), [list, filter]);

  const create = useMutation({
    mutationFn: () =>
      createDarva({
        reference: form.reference || null,
        claim_ref: form.claim_ref || null,
        insurer: form.insurer || null,
        plate: form.plate.toUpperCase() || null,
        message_type: form.message_type,
        direction: form.direction,
        amount: form.amount ? Number(form.amount) : null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      toast.success("Échange DARVA enregistré");
      setOpen(false);
      setForm({ reference: "", claim_ref: "", insurer: "", plate: "", message_type: "mission", direction: "in", amount: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["darva"] });
    },
    onError: (e) => toastError(e, "Enregistrement DARVA impossible"),
  });

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateDarvaStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["darva"] }),
    onError: (e) => toastError(e, "Changement de statut impossible"),
  });

  return (
    <AppShell
      title="Gestion DARVA"
      subtitle="Missions, accords et règlements assureurs"
      back={{ to: "/" }}
      right={
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg bg-brand px-3 py-2 text-brand-foreground" aria-label="Nouvel échange">
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {DARVA_STATUS.slice(0, 3).map((s) => (
          <Counter
            key={s.key}
            label={s.label}
            value={list.filter((r) => r.status === s.key).length}
            active={filter === s.key}
            onClick={() => setFilter(filter === s.key ? "" : s.key)}
          />
        ))}
      </div>

      {open ? (
        <Section title="Nouvel échange">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <Field label="Référence dossier" value={form.reference} onChange={(v) => setForm({ ...form, reference: v })} />
            <Field label="N° de sinistre" value={form.claim_ref} onChange={(v) => setForm({ ...form, claim_ref: v })} />
            <Field label="Assureur" value={form.insurer} onChange={(v) => setForm({ ...form, insurer: v })} />
            <Field label="Immatriculation" value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} />
            <Select label="Type de message" value={form.message_type} onChange={(v) => setForm({ ...form, message_type: v })} options={DARVA_TYPES} allowEmpty={false} />
            <Select
              label="Sens"
              value={form.direction}
              onChange={(v) => setForm({ ...form, direction: v })}
              options={[{ key: "in", label: "Reçu de l'assureur" }, { key: "out", label: "Envoyé à l'assureur" }]}
              allowEmpty={false}
            />
            <Field label="Montant (€)" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            <Area label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              Enregistrer
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`Échanges (${visible.length})`}>
        {rows.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!rows.isLoading && !visible.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucun échange DARVA enregistré. Utilisez le bouton + pour tracer une mission ou un accord assureur.
          </p>
        ) : null}
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className="rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Badge tone={darvaTone(r.status)}>{darvaLabel(DARVA_STATUS, r.status)}</Badge>
                <Badge>{darvaLabel(DARVA_TYPES, r.message_type)}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.occurred_at).toLocaleDateString("fr-FR")}
                </span>
              </div>
              <div className="mt-2 text-sm font-bold">
                {r.insurer ?? "Assureur non précisé"} {r.plate ? `— ${r.plate}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {[r.reference, r.claim_ref, r.amount != null ? `${r.amount} €` : null].filter(Boolean).join(" · ") || "—"}
              </div>
              {r.notes ? <p className="mt-1 text-xs">{r.notes}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {DARVA_STATUS.filter((s) => s.key !== r.status).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => advance.mutate({ id: r.id, status: s.key })}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}