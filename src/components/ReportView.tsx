import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { MediaThumb } from "@/components/PhotoManager";
import { useLightbox } from "@/components/PhotoLightbox";
import { StatusBadge, StatusPicker, type PointStatus } from "@/components/StatusPicker";
import { ctSummaryLabel, formatCtDate, POLLUTION_PREFIX, reportCtDates } from "@/lib/ct";
import { formatPlate } from "@/lib/plate";
import type { ReportData, ReportMedia } from "@/lib/report";

export function Summary({ d, clientView }: { d: ReportData; clientView?: boolean }) {
  const date = new Date(d.inspection.completed_at ?? d.inspection.started_at ?? Date.now());
  const startedAt = d.inspection.started_at ? new Date(d.inspection.started_at) : null;
  const finishedAt = d.inspection.finished_at
    ? new Date(d.inspection.finished_at)
    : d.inspection.completed_at
      ? new Date(d.inspection.completed_at)
      : null;
  const duration =
    d.inspection.duration_seconds ??
    (startedAt && finishedAt
      ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
      : null);
  const hhmm = (v: Date) => v.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
    return m > 0 ? `${m} min` : `${s} s`;
  };
  const ctDates = reportCtDates(d);
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
      <div className="font-semibold">
        {d.inspection.mileage ? `${d.inspection.mileage.toLocaleString("fr-FR")} km · ` : ""}
        {ctSummaryLabel(ctDates.ct)}
      </div>
      {formatCtDate(ctDates.pollution) ? (
        <div className="text-xs font-semibold text-muted-foreground">
          {POLLUTION_PREFIX} {formatCtDate(ctDates.pollution)}.
        </div>
      ) : null}
      {startedAt || finishedAt || duration != null ? (
        <div className="text-xs font-semibold text-muted-foreground">
          {[
            startedAt ? `Début : ${hhmm(startedAt)}` : "",
            finishedAt ? `Fin : ${hhmm(finishedAt)}` : "",
            duration != null ? `Durée : ${formatDuration(duration)}` : "",
            d.inspection.completed_by_name ? `Terminé par ${d.inspection.completed_by_name}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
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
  editable,
  onSaved,
}: {
  d: ReportData;
  detailed: boolean;
  clientView: boolean;
  /** Correction directe des points par l'utilisateur (aucune relance d'analyse IA). */
  editable?: boolean;
  onSaved?: () => void;
}) {
  const zones = Array.from(new Set(d.points.map((p) => p.zone_index))).sort((a, b) => a - b);
  const visiblePoints = (zi: number) =>
    d.points
      .filter((p) => p.zone_index === zi)
      .filter((p) => (clientView || !detailed ? p.status === "watch" || p.status === "defect" : true));

  const mediaFor = (key: "inspection_point_id" | "observation_id", id: string) =>
    d.media.filter((m) => m[key] === id);

  const lightbox = useLightbox();
  const openPhotos = (media: ReportMedia[], i: number, label: string) =>
    lightbox.open(
      media.map((m) => ({ path: m.storage_path, label })),
      i,
    );

  return (
    <div className="space-y-4">
      {lightbox.node}
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
                {editable && !clientView ? null : <StatusBadge status={o.status} />}
              </div>
              {editable && !clientView ? (
                <ItemEditor
                  table="observations"
                  id={o.id}
                  status={o.status}
                  comment={o.comment}
                  measureValue={o.measure_value}
                  measureUnit={o.measure_unit}
                  {...(onSaved ? { onSaved } : {})}
                />
              ) : null}
              {o.measure_value && !editable ? (
                <div className="text-sm">
                  Mesure : {o.measure_value} {o.measure_unit}
                </div>
              ) : null}
              {editable && !clientView ? null : clientView ? (
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
              <PhotoRow
                media={mediaFor("observation_id", o.id)}
                label={o.element}
                onOpen={openPhotos}
              />
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
                  {editable && !clientView ? null : <StatusBadge status={p.status} />}
                </div>
                {editable && !clientView ? (
                  <ItemEditor
                    table="inspection_points"
                    id={p.id}
                    status={p.status}
                    comment={p.comment}
                    measureValue={p.measure_value}
                    measureUnit={p.measure_unit}
                    {...(onSaved ? { onSaved } : {})}
                  />
                ) : null}
                {p.measure_value && !editable ? (
                  <div className="text-sm">
                    Mesure : {p.measure_value} {p.measure_unit}
                  </div>
                ) : null}
                {editable && !clientView ? null : clientView ? (
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
                  <PhotoRow
                    media={mediaFor("inspection_point_id", p.id)}
                    label={p.point_label}
                    onOpen={openPhotos}
                  />
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
          <PhotoRow
            media={d.media.filter((m) => !m.inspection_point_id && !m.observation_id)}
            label="Photo du tour"
            onOpen={openPhotos}
          />
        </section>
      ) : null}
    </div>
  );
}

function PhotoRow({
  media,
  label,
  onOpen,
}: {
  media: ReportMedia[];
  label: string;
  onOpen: (media: ReportMedia[], index: number, label: string) => void;
}) {
  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onOpen(media, i, label)}
          aria-label={`Agrandir la photo — ${label}`}
          className="rounded-lg"
        >
          <MediaThumb
            path={m.thumb_path ?? m.storage_path}
            className="h-24 w-24 rounded-lg object-cover"
          />
        </button>
      ))}
    </div>
  );
}

/**
 * Correction directe d'un point de contrôle ou d'une observation depuis le
 * rapport : statut, mesure et commentaire. Aucune analyse IA n'est relancée ;
 * la correction efface le commentaire client généré pour que la version
 * corrigée soit celle vue par le client, dans le PDF et dans le devis.
 */
function ItemEditor({
  table,
  id,
  status,
  comment,
  measureValue,
  measureUnit,
  onSaved,
}: {
  table: "inspection_points" | "observations";
  id: string;
  status: string;
  comment: string | null;
  measureValue: string | null;
  measureUnit: string | null;
  onSaved?: () => void;
}) {
  const [st, setSt] = useState<PointStatus>((status as PointStatus) ?? "unset");
  const [text, setText] = useState(comment ?? "");
  const [measure, setMeasure] = useState(measureValue ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSt((status as PointStatus) ?? "unset");
    setText(comment ?? "");
    setMeasure(measureValue ?? "");
  }, [status, comment, measureValue]);

  const dirty =
    st !== ((status as PointStatus) ?? "unset") ||
    text !== (comment ?? "") ||
    measure !== (measureValue ?? "");

  async function save() {
    setSaving(true);
    try {
      const patch = {
        status: st,
        comment: text.trim() ? text.trim() : null,
        client_comment: null,
        measure_value: measure.trim() ? measure.trim() : null,
        updated_at: new Date().toISOString(),
      };
      const { error } =
        table === "inspection_points"
          ? await supabase.from("inspection_points").update(patch).eq("id", id)
          : await supabase.from("observations").update(patch).eq("id", id);
      if (error) throw error;
      toast.success("Correction enregistrée");
      onSaved?.();
    } catch (e) {
      console.error(e);
      toast.error("Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border-2 border-border p-2">
      <StatusPicker value={st} onChange={setSt} compact />
      {measureValue != null || measureUnit ? (
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
            aria-label="Mesure"
            className="w-24 rounded-lg border-2 border-border bg-card px-2 py-2 text-center text-sm outline-none focus:border-brand"
          />
          <span className="text-xs font-semibold text-muted-foreground">{measureUnit ?? ""}</span>
        </div>
      ) : null}
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Commentaire"
        aria-label="Commentaire"
        className="w-full rounded-lg border-2 border-border bg-card px-2 py-2 text-sm outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        className="w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50"
      >
        {saving ? "Enregistrement…" : dirty ? "Enregistrer la correction" : "Enregistré"}
      </button>
    </div>
  );
}
