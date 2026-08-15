import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusPicker";
import { supabase } from "@/integrations/supabase/client";
import { formatPlate } from "@/lib/plate";
import { fetchReport } from "@/lib/report";

export const Route = createFileRoute("/tour/$tourId/presentation")({
  head: () => ({
    meta: [
      { title: "Présentation client — DDA Connect" },
      {
        name: "description",
        content:
          "Rédigez la version client du compte rendu : reformulez chaque point avant envoi au propriétaire du véhicule.",
      },
      { property: "og:title", content: "Présentation client — DDA Connect" },
      {
        property: "og:description",
        content: "Reformulez les constats techniques pour le client avant envoi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PresentationPage,
});

type Draft = Record<string, string>;

function PresentationPage() {
  const { tourId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const report = useQuery({
    queryKey: ["report", tourId],
    queryFn: () => fetchReport({ id: tourId }),
  });

  useEffect(() => {
    const d = report.data;
    if (!d) return;
    const init: Draft = {};
    for (const p of d.points) {
      if (p.status === "watch" || p.status === "defect")
        init[`p:${p.id}`] = p.client_comment ?? p.comment ?? "";
    }
    for (const o of d.observations) init[`o:${o.id}`] = o.client_comment ?? o.comment ?? "";
    setDraft(init);
  }, [report.data]);

  if (report.isLoading || !report.data) {
    return (
      <AppShell title="Présentation client">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  const d = report.data;
  const items = [
    ...d.points
      .filter((p) => p.status === "watch" || p.status === "defect")
      .map((p) => ({
        key: `p:${p.id}`,
        title: p.point_label,
        sub: p.zone_label,
        status: p.status,
        technical: p.comment ?? "",
      })),
    ...d.observations.map((o) => ({
      key: `o:${o.id}`,
      title: o.element,
      sub: o.category,
      status: o.status,
      technical: o.comment ?? "",
    })),
  ];

  async function save() {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(draft).map(([key, value]) => {
          const [kind, id] = key.split(":") as ["p" | "o", string];
          const table = kind === "p" ? "inspection_points" : "observations";
          return supabase
            .from(table)
            .update({ client_comment: value.trim() || null })
            .eq("id", id);
        }),
      );
      await supabase
        .from("vehicle_inspections")
        .update({ client_content_updated_at: new Date().toISOString() })
        .eq("id", tourId);
      await qc.invalidateQueries({ queryKey: ["report", tourId] });
      await qc.invalidateQueries({ queryKey: ["recent-tours"] });
      toast.success("Présentation client enregistrée");
      navigate({ to: "/tour/$tourId/rapport", params: { tourId } });
    } catch (e) {
      console.error(e);
      toast.error("Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Présentation client"
      subtitle={formatPlate(d.vehicle?.plate ?? "")}
      back={{ to: "/tour/$tourId/rapport", params: { tourId } }}
    >
      <div className="space-y-4 pb-4">
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
          Reformulez chaque constat dans un langage clair pour le client. Le commentaire technique
          reste visible uniquement dans le rapport atelier.
        </p>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun point à présenter : ce tour ne comporte aucun défaut ni point à surveiller.
          </p>
        ) : null}

        {items.map((it) => (
          <div key={it.key} className="card-surface space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">{it.title}</div>
                <div className="text-xs text-muted-foreground">{it.sub}</div>
              </div>
              <StatusBadge status={it.status} />
            </div>
            {it.technical ? (
              <p className="rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground">
                Technique : {it.technical}
              </p>
            ) : null}
            <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Commentaire client
            </label>
            <textarea
              value={draft[it.key] ?? ""}
              onChange={(e) => setDraft((s) => ({ ...s, [it.key]: e.target.value }))}
              rows={3}
              placeholder="Ex. : les plaquettes avant sont usées, un remplacement est à prévoir rapidement."
              className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        ))}

        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground"
        >
          <Save className="h-5 w-5" /> {saving ? "Enregistrement…" : "Enregistrer la présentation"}
        </button>
      </div>
    </AppShell>
  );
}
