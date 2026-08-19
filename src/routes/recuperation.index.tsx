import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Counter, Field, Section, Select } from "@/components/bits";
import { toastError } from "@/lib/errors";
import {
  CHECKLIST,
  createHandover,
  HANDOVER_KINDS,
  HANDOVER_STATUS,
  labelOf,
  listHandovers,
  updateHandover,
  type Handover,
} from "@/lib/handovers";
import { useSite } from "@/lib/site-context";

export const Route = createFileRoute("/recuperation/")({
  head: () => ({
    meta: [
      { title: "Récupération & livraisons VN/VO — DDA Connect" },
      { name: "description", content: "Planification des récupérations de véhicules et des livraisons VN/VO avec checklist de préparation." },
      { property: "og:title", content: "Récupération & livraisons VN/VO" },
      { property: "og:description", content: "Checklists de récupération et de livraison véhicules neufs et occasion." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HandoverHub,
});

function HandoverHub() {
  const qc = useQueryClient();
  const { site } = useSite();
  const rows = useQuery({ queryKey: ["handovers"], queryFn: listHandovers });
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: "recuperation",
    plate: "",
    model: "",
    customer_name: "",
    customer_phone: "",
    address: "",
    scheduled_at: "",
    notes: "",
  });

  const list = rows.data ?? [];
  const visible = useMemo(() => (kind ? list.filter((h) => h.kind === kind) : list), [list, kind]);

  const create = useMutation({
    mutationFn: () =>
      createHandover({
        kind: form.kind,
        plate: form.plate.toUpperCase() || null,
        model: form.model || null,
        customer_name: form.customer_name || null,
        customer_phone: form.customer_phone || null,
        address: form.address || null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        notes: form.notes || null,
        site_id: site?.id ?? null,
      }),
    onSuccess: () => {
      toast.success("Intervention planifiée");
      setOpen(false);
      setForm({ kind: "recuperation", plate: "", model: "", customer_name: "", customer_phone: "", address: "", scheduled_at: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["handovers"] });
    },
    onError: (e) => toastError(e, "Planification impossible"),
  });

  const patch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Handover> }) => updateHandover(id, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["handovers"] }),
    onError: (e) => toastError(e, "Mise à jour impossible"),
  });

  return (
    <AppShell
      title="Récupération & livraisons"
      subtitle="Récupérations, VN et VO"
      back={{ to: "/" }}
      right={
        <button onClick={() => setOpen((v) => !v)} aria-label="Nouvelle intervention" className="rounded-lg bg-brand px-3 py-2 text-brand-foreground">
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {HANDOVER_KINDS.map((k) => (
          <Counter
            key={k.key}
            label={k.label}
            value={list.filter((h) => h.kind === k.key && h.status !== "termine").length}
            active={kind === k.key}
            onClick={() => setKind(kind === k.key ? "" : k.key)}
          />
        ))}
      </div>

      {open ? (
        <Section title="Nouvelle intervention">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <Select label="Type" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={HANDOVER_KINDS} allowEmpty={false} />
            <Field label="Immatriculation" value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} />
            <Field label="Modèle" value={form.model} onChange={(v) => setForm({ ...form, model: v })} />
            <Field label="Client" value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} />
            <Field label="Téléphone" value={form.customer_phone} onChange={(v) => setForm({ ...form, customer_phone: v })} />
            <Field label="Adresse" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            <Field label="Date prévue" type="datetime-local" value={form.scheduled_at} onChange={(v) => setForm({ ...form, scheduled_at: v })} />
            <Area label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              Planifier
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`Interventions (${visible.length})`}>
        {!rows.isLoading && !visible.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune intervention planifiée. Créez une récupération ou une livraison pour suivre sa checklist.
          </p>
        ) : null}
        <div className="space-y-2">
          {visible.map((h) => {
            const steps = CHECKLIST[h.kind] ?? [];
            const done = steps.filter((s) => h.checklist[s.key]).length;
            return (
              <div key={h.id} className="rounded-xl border-2 border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="bg-brand/10 text-brand">{labelOf(HANDOVER_KINDS, h.kind)}</Badge>
                  <Badge>{labelOf(HANDOVER_STATUS, h.status)}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {h.scheduled_at ? new Date(h.scheduled_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </span>
                </div>
                <div className="mt-2 text-sm font-bold">
                  {h.plate ?? "—"} {h.model ? `· ${h.model}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[h.customer_name, h.customer_phone, h.address].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="mt-2 space-y-1">
                  {steps.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!h.checklist[s.key]}
                        onChange={(e) =>
                          patch.mutate({ id: h.id, data: { checklist: { ...h.checklist, [s.key]: e.target.checked } } })
                        }
                        className="h-5 w-5"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase text-muted-foreground">
                    {done}/{steps.length} points
                  </span>
                  {h.status !== "termine" ? (
                    <button
                      onClick={() => patch.mutate({ id: h.id, data: { status: "termine", done_at: new Date().toISOString() } })}
                      className="ml-auto rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase"
                    >
                      Clôturer
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </AppShell>
  );
}