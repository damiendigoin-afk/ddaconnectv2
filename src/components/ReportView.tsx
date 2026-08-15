import { MediaThumb } from "@/components/PhotoManager";
import { StatusBadge } from "@/components/StatusPicker";
import { formatPlate } from "@/lib/plate";
import type { ReportData } from "@/lib/report";

export function Summary({ d, clientView }: { d: ReportData; clientView?: boolean }) {
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
        {clientView ? (
          <span>
            {counts.watch} point(s) à surveiller · {counts.defect + d.observations.length} défaut(s)
            constaté(s)
          </span>
        ) : d.inspection.inspection_type === "guide" ? (
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
      {d.inspection.inspection_type === "libre" && !clientView ? (
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
              {clientView ? (
                o.client_comment || o.comment ? (
                  <p className="text-sm">{o.client_comment || o.comment}</p>
                ) : null
              ) : (
                <>
                  {o.comment ? <p className="text-sm">{o.comment}</p> : null}
                  {o.client_comment ? (
                    <p className="rounded-lg bg-secondary px-2 py-1 text-sm">
                      <span className="text-xs font-bold uppercase text-muted-foreground">
                        Version client :{" "}
                      </span>
                      {o.client_comment}
                    </p>
                  ) : null}
                </>
              )}
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
                {clientView ? (
                  p.client_comment || p.comment ? (
                    <p className="text-sm">{p.client_comment || p.comment}</p>
                  ) : null
                ) : (
                  <>
                    {p.comment ? <p className="text-sm">{p.comment}</p> : null}
                    {p.client_comment ? (
                      <p className="rounded-lg bg-secondary px-2 py-1 text-sm">
                        <span className="text-xs font-bold uppercase text-muted-foreground">
                          Version client :{" "}
                        </span>
                        {p.client_comment}
                      </p>
                    ) : null}
                  </>
                )}
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