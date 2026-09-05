/** Référentiel des équivalences véhicules (consultation + correction manager). */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  CONFIDENCE_LABEL,
  fetchEquivalences,
  saveEquivalence,
  searchEquivalences,
  type VehicleEquivalence,
} from "@/lib/vehicle-equivalences";

export const Route = createFileRoute("/parametrage/equivalences")({
  head: () => ({
    meta: [
      { title: "Équivalences véhicules — DDA Connect" },
      {
        name: "description",
        content:
          "Référentiel des rapprochements entre modèles (2008 ↔ Captur, 208 / C3 ↔ Clio) pour le chiffrage des opérations généralistes.",
      },
      { property: "og:title", content: "Équivalences véhicules — DDA Connect" },
      {
        property: "og:description",
        content: "Rapprochements de modèles utilisés par le chiffrage généraliste.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EquivalencesPage,
});

const EMPTY = {
  brand_a: "",
  model_a: "",
  brand_b: "",
  model_b: "",
  segment: "",
  body_type: "",
  generation: "",
  engine: "",
  confidence: "moyen",
  reason: "",
};

function EquivalencesPage() {
  const { isManager, user } = useAuth();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const list = useQuery({ queryKey: ["vehicle-equivalences"], queryFn: fetchEquivalences });
  const rows = useMemo(
    () => searchEquivalences((list.data ?? []) as VehicleEquivalence[], search),
    [list.data, search],
  );

  async function add() {
    if (!form.model_a.trim() || !form.model_b.trim()) {
      toast.error("Indiquez les deux modèles à rapprocher.");
      return;
    }
    setSaving(true);
    try {
      await saveEquivalence({
        brand_a: form.brand_a.trim() || "—",
        model_a: form.model_a.trim(),
        brand_b: form.brand_b.trim() || "—",
        model_b: form.model_b.trim(),
        segment: form.segment.trim() || null,
        body_type: form.body_type.trim() || null,
        generation: form.generation.trim() || null,
        engine: form.engine.trim() || null,
        confidence: form.confidence,
        reason: form.reason.trim() || null,
        created_by: user?.id ?? null,
      });
      setForm({ ...EMPTY });
      await list.refetch();
      toast.success("Équivalence enregistrée.");
    } catch {
      toast.error("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: VehicleEquivalence) {
    try {
      await saveEquivalence({ id: row.id, active: !row.active });
      await list.refetch();
    } catch {
      toast.error("Modification impossible.");
    }
  }

  return (
    <AppShell title="Équivalences véhicules">
      <div className="space-y-4 p-4">
        <section className="card-surface space-y-2 p-4">
          <h1 className="text-sm font-bold uppercase tracking-widest">Équivalences véhicules</h1>
          <p className="text-xs text-muted-foreground">
            Référentiel de consultation pour les opérations généralistes : 2008 ↔ Captur, 208 / C3 ↔
            Clio selon le segment, la carrosserie, la génération et, si utile, la motorisation. Une
            équivalence n'est jamais forcée : le niveau de rapprochement et sa raison restent
            affichés, et une équivalence douteuse peut être désactivée.
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un modèle, un segment, une carrosserie"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </section>

        <section className="card-surface space-y-2 p-4">
          {list.isLoading ? (
            <p className="text-xs text-muted-foreground">Chargement…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Aucune équivalence enregistrée pour cette recherche.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {rows.map((e) => (
                <li key={e.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">
                      {e.brand_a} {e.model_a} ↔ {e.brand_b} {e.model_b}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {CONFIDENCE_LABEL[e.confidence as keyof typeof CONFIDENCE_LABEL] ?? e.confidence}
                      {e.active ? "" : " · désactivée"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {[e.segment, e.body_type, e.generation, e.engine].filter(Boolean).join(" · ") || "—"}
                    {e.reason ? ` — ${e.reason}` : ""}
                  </div>
                  {isManager ? (
                    <button
                      onClick={() => void toggle(e)}
                      className="mt-1 text-[10px] font-bold uppercase underline"
                    >
                      {e.active ? "Désactiver" : "Réactiver"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {isManager ? (
          <section className="card-surface space-y-2 p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest">
              Ajouter une équivalence (correction exceptionnelle)
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["brand_a", "Marque A"],
                  ["model_a", "Modèle A"],
                  ["brand_b", "Marque B"],
                  ["model_b", "Modèle B"],
                  ["segment", "Segment"],
                  ["body_type", "Carrosserie / gabarit"],
                  ["generation", "Génération / années"],
                  ["engine", "Motorisation (facultatif)"],
                  ["reason", "Raison du rapprochement"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {label}
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
                  />
                </label>
              ))}
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Niveau de rapprochement
                <select
                  value={form.confidence}
                  onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
                >
                  {Object.entries(CONFIDENCE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              onClick={() => void add()}
              disabled={saving}
              className="w-full rounded-xl bg-brand px-4 py-3 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50"
            >
              Enregistrer l'équivalence
            </button>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
