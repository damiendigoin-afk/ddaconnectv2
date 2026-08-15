import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { MediaThumb } from "@/components/PhotoManager";
import { StatusBadge } from "@/components/StatusPicker";
import { formatPlate } from "@/lib/plate";
import { fetchReport, type ReportData } from "@/lib/report";

export const Route = createFileRoute("/tour/$tourId/rapport")({
  head: () => ({
    meta: [
      { title: "Rapport de tour véhicule — DDA Connect" },
      {
        name: "description",
        content: "Rapport atelier complet : contrôles, statuts, mesures, commentaires et photos.",
      },
      { property: "og:title", content: "Rapport de tour véhicule — DDA Connect" },
      { property: "og:description", content: "Rapport atelier complet du tour véhicule." },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { tourId } = Route.useParams();
  const [detailed, setDetailed] = useState(true);
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  if (report.isLoading || !report.data) {
    return (
      <AppShell title="Rapport">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  const d = report.data;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/partage/${d.inspection.share_token}`
      : "";

  return (
    <AppShell
      title="Rapport atelier"
      subtitle={formatPlate(d.vehicle?.plate ?? "")}
      back={d.order ? { to: "/or/$orId", params: { orId: d.order.id } } : { to: "/" }}
    >
      <div className="space-y-4">
        <Summary d={d} />

        <div className="grid grid-cols-2 gap-2">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            <ExternalLink className="h-4 w-4" /> Aperçu client
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              toast.success("Lien copié");
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground"
          >
            <Copy className="h-4 w-4" /> Copier le lien
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDetailed(false)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${!detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Synthèse
          </button>
          <button
            onClick={() => setDetailed(true)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Détail
          </button>
        </div>

        <ReportBody d={d} detailed={detailed} clientView={false} />
      </div>
    </AppShell>
  );
}

export function Summary({ d }: { d: ReportData }) {
  const date = new Date(d.inspection.completed_at ?? d.inspection.started_at);
  const counts = {
    ok: d.points.filter((p) => p.status === "ok").length,
    watch: d.points.filter((p) => p.status === "watch").length,
    defect: d.points.filter((p) => p.status === "defect").length,
    unset: d.points.filter((p) => p.status === "unset").length,
  };
  return (
    <section className="card-surface space-y-1 p-4 text-sm">
      <div className="plate-badge text-2xl">{formatPlate(d.vehicle?.plate ?? "")}</div>
      <div className="font-semibold">
        {[d.vehicle?.brand, d.vehicle?.model].filter(Boolean).join(" ")}
      </div>
      <div className="text-muted-foreground">
        {d.inspection.inspection_type === "guide" ? "Tour guidé" : "Tour libre"} ·{" "}
        {date.toLocaleDateString("fr-FR")} à{" "}
        {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
      </div>
      {d.inspection.mileage ? (
        <div className="font-semibold">{d.inspection.mileage.toLocaleString("fr-FR")} km</div>
      ) : null}
      <div className="pt-2 text-sm">
        {d.inspection.inspection_type === "guide" ? (
          <span>
            {counts.ok} OK · {counts.watch} à surveiller · {counts.defect} défaut(s) ·{" "}
            {counts.unset} non renseigné(s) · {d.media.length} photo(s)
          </span>
        ) : (
          <span>
            {d.observations.length} défaut(s) signalé(s) · {d.media.length} photo(s)
          </span>
        )}
      </div>
      {d.inspection.inspection_type === "libre" ? (
        <p className="pt-1 text-xs text-muted-foreground">
          Tour libre : seuls les éléments signalés ci-dessous ont fait l'objet d'une observation.
        </p>
      ) : null}
    </section>
  );
}

export function ReportBody({
  d,
  detailed,
  clientView,
}: {
  d: ReportData;
  detailed: boolean;
  clientView: boolean;
}) {
  const zones = Array.from(new Set(d.points.map((p) => p.zone_index))).sort((a, b) => a - b);
  const visiblePoints = (zi: number) =>
    d.points
      .filter((p) => p.zone_index === zi)
      .filter((p) => (clientView || !detailed ? p.status === "watch" || p.status === "defect" : true));

  const mediaFor = (key: "inspection_point_id" | "observation_id", id: string) =>
    d.media.filter((m) => m[key] === id);

  return (
    <div className="space-y-4">
      {d.observations.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Défauts signalés
          </h2>
          {d.observations.map((o) => (
            <div key={o.id} className="card-surface space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{o.element}</div>
                  <div className="text-xs text-muted-foreground">{o.category}</div>
                </div>
                <StatusBadge status={o.status} />
              </div>
              {o.measure_value ? (
                <div className="text-sm">
                  Mesure : {o.measure_value} {o.measure_unit}
                </div>
              ) : null}
              {o.comment ? <p className="text-sm">{o.comment}</p> : null}
              <PhotoRow media={mediaFor("observation_id", o.id)} />
            </div>
          ))}
        </section>
      ) : null}

      {zones.map((zi) => {
        const pts = visiblePoints(zi);
        if (pts.length === 0) return null;
        return (
          <section key={zi} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {pts[0]!.zone_label}
            </h2>
            {pts.map((p) => (
              <div key={p.id} className="card-surface space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{p.point_label}</span>
                  <StatusBadge status={p.status} />
                </div>
                {p.measure_value ? (
                  <div className="text-sm">
                    Mesure : {p.measure_value} {p.measure_unit}
                  </div>
                ) : null}
                {p.comment ? <p className="text-sm">{p.comment}</p> : null}
                {clientView && p.status !== "watch" && p.status !== "defect" ? null : (
                  <PhotoRow media={mediaFor("inspection_point_id", p.id)} />
                )}
              </div>
            ))}
          </section>
        );
      })}

      {!clientView && detailed ? (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Autres photos du tour
          </h2>
          <PhotoRow media={d.media.filter((m) => !m.inspection_point_id && !m.observation_id)} />
        </section>
      ) : null}
    </div>
  );
}

function PhotoRow({ media }: { media: { id: string; storage_path: string }[] }) {
  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m) => (
        <MediaThumb key={m.id} path={m.storage_path} className="h-24 w-24 rounded-lg object-cover" />
      ))}
    </div>
  );
}