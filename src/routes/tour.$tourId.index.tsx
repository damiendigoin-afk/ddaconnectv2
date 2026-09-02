import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, LogOut, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { MileageCard } from "@/components/MileageCard";
import { PendingUploadsGuard } from "@/components/PendingUploadsGuard";
import { PhotoManager } from "@/components/PhotoManager";
import { PointCard, type PointRow } from "@/components/PointCard";
import { TechnicalControlCard } from "@/components/TechnicalControlCard";
import { TireLabelCard } from "@/components/TireLabelCard";
import { TireWheelCard } from "@/components/TireWheelCard";
import type { TireLabelAi } from "@/lib/tire-types";
import { StatusBadge, StatusPicker, type PointStatus } from "@/components/StatusPicker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { uploadPhoto } from "@/lib/photo";
import { finishTour } from "@/lib/tour-finish";
import { markTourModified } from "@/lib/tour-admin";
import { parseTireReference } from "@/lib/tires";
import { useUploadState } from "@/lib/upload-tracker";
import { FREE_CATEGORIES, GUIDED_ZONES } from "@/lib/zones";

export const Route = createFileRoute("/tour/$tourId/")({
  // Un tour terminé reste modifiable : ?edit=1 rouvre les contrôles.
  validateSearch: (search: Record<string, unknown>): { edit?: boolean } =>
    search["edit"] === "1" || search["edit"] === 1 || search["edit"] === true ? { edit: true } : {},
  head: () => ({
    meta: [
      { title: "Tour véhicule — DDA Connect" },
      { name: "description", content: "Contrôles, mesures, commentaires et photos du tour véhicule." },
      { property: "og:title", content: "Tour véhicule — DDA Connect" },
      { property: "og:description", content: "Réalisez le tour véhicule atelier depuis le smartphone." },
    ],
  }),
  component: TourPage,
});

async function loadTour(id: string) {
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .select("*, repair_order:repair_orders(id, or_number), vehicle:vehicles(id, plate, brand, model, last_mileage, ct_due_date, pollution_due_date, tire_size_front, tire_size_rear)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

function TourPage() {
  const { tourId } = Route.useParams();
  const { edit } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, displayName } = useAuth();
  const tour = useQuery({ queryKey: ["tour", tourId], queryFn: () => loadTour(tourId) });

  const vehicle = tour.data?.vehicle as { id: string; plate: string; last_mileage: number | null } | null;
  const order = tour.data?.repair_order as { id: string } | null;

  const completed = tour.data?.status === "completed";
  const editingCompleted = completed && edit;
  useEffect(() => {
    if (completed && !edit) navigate({ to: "/tour/$tourId/rapport", params: { tourId } });
  }, [completed, edit, navigate, tourId]);

  // V3 : le chronomètre démarre automatiquement en arrière-plan à l'ouverture du tour.
  const notStarted = !!tour.data && !tour.data.started_at && !completed;
  useEffect(() => {
    if (!notStarted || !user) return;
    let alive = true;
    void supabase
      .rpc("start_vehicle_inspection", {
        _inspection_id: tourId,
        _user_id: user.id,
        _user_name: displayName || "Utilisateur",
      })
      .then(({ error }) => {
        if (!alive || error) return;
        void qc.invalidateQueries({ queryKey: ["tour", tourId] });
      });
    return () => {
      alive = false;
    };
  }, [notStarted, user, tourId, displayName, qc]);

  if (tour.isLoading || !tour.data || !vehicle || !order) {
    return (
      <AppShell title="Tour véhicule">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  if (completed && !edit) return null;

  const quit = () => {
    toast.success("Tour sauvegardé en brouillon.");
    navigate({ to: "/or/$orId", params: { orId: order.id } });
  };

  const deleteDraft = async () => {
    if (!window.confirm("Supprimer définitivement ce brouillon ?")) return;
    await supabase.from("vehicle_inspections").delete().eq("id", tourId);
    await qc.invalidateQueries({ queryKey: ["inspections", order.id] });
    toast.success("Brouillon supprimé");
    navigate({ to: "/or/$orId", params: { orId: order.id } });
  };

  const shared = {
    editingCompleted: Boolean(editingCompleted),
    tourId,
    orderId: order.id,
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    lastMileage: vehicle.last_mileage,
    mileage: tour.data.mileage as number | null,
    zoneIndex: tour.data.current_zone_index as number,
    ctDueDate: (vehicle as unknown as { ct_due_date?: string | null }).ct_due_date ?? null,
    pollutionDueDate: (vehicle as unknown as { pollution_due_date?: string | null }).pollution_due_date ?? null,
    tireSizeFront: (vehicle as unknown as { tire_size_front?: string | null }).tire_size_front ?? null,
    tireSizeRear: (vehicle as unknown as { tire_size_rear?: string | null }).tire_size_rear ?? null,
    quit,
    deleteDraft,
  };

  return tour.data.inspection_type === "guide" ? <Guided {...shared} /> : <Free {...shared} />;
}

type SharedProps = {
  /** Reprise d'un tour déjà clôturé : la clôture initiale est préservée. */
  editingCompleted: boolean;
  tourId: string;
  orderId: string;
  vehicleId: string;
  plate: string;
  lastMileage: number | null;
  mileage: number | null;
  zoneIndex: number;
  ctDueDate: string | null;
  pollutionDueDate: string | null;
  /** Monte mémorisée sur la fiche véhicule : vaut référence d'essieu confirmée. */
  tireSizeFront: string | null;
  tireSizeRear: string | null;
  quit: () => void;
  deleteDraft: () => void;
};

function TourNav({
  quit,
  deleteDraft,
  editingCompleted,
}: {
  quit: () => void;
  deleteDraft: () => void;
  editingCompleted?: boolean;
}) {
  return (
    <div className="mb-3 space-y-2">
      {editingCompleted ? (
        <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs font-bold uppercase text-status-watch">
          Modification d'un tour terminé — la clôture initiale est conservée
        </p>
      ) : null}
      <div className="flex gap-2">
      <button
        onClick={quit}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold"
      >
        <LogOut className="h-4 w-4" /> Quitter le tour
      </button>
      <button
        onClick={deleteDraft}
        className="flex items-center justify-center gap-2 rounded-lg border-2 border-destructive px-3 py-2 text-sm font-semibold text-destructive"
      >
        <Trash2 className="h-4 w-4" /> Supprimer
      </button>
      </div>
    </div>
  );
}

/* ------------------------------- TOUR GUIDÉ ------------------------------- */

function Guided(props: SharedProps) {
  const navigate = useNavigate();
  const { user, displayName } = useAuth();
  const [zone, setZone] = useState(Math.min(props.zoneIndex, GUIDED_ZONES.length));
  const [mileage, setMileage] = useState(props.mileage);
  const [showSummary, setShowSummary] = useState(false);
  // Étiquette pneumatiques lue côté conducteur : sert de dimension homologuée
  // de référence pour les quatre roues du tour en cours.
  const [tireLabel, setTireLabel] = useState<TireLabelAi | null>(null);

  const points = useQuery({
    queryKey: ["points", props.tourId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspection_points")
        .select("*")
        .eq("inspection_id", props.tourId)
        .order("zone_index");
      if (error) throw error;
      let rows = data as (PointRow & { zone_index: number; zone_label: string })[];
      // Auto-réparation : un tour commencé avant l'ajout d'un point de contrôle
      // (ex. contrôle technique) doit tout de même l'afficher.
      if (rows.length > 0) {
        const existing = new Set(rows.map((p) => p.point_key));
        const missing = GUIDED_ZONES.flatMap((zone, zi) =>
          zone.points
            .filter((p) => !existing.has(p.key))
            .map((p) => ({
              inspection_id: props.tourId,
              zone_key: zone.key,
              zone_label: zone.label,
              zone_index: zi + 1,
              point_key: p.key,
              point_label: p.label,
            })),
        );
        if (missing.length > 0) {
          const { data: added } = await supabase.from("inspection_points").insert(missing).select("*");
          if (added) {
            rows = [...rows, ...(added as typeof rows)].sort((a, b) => a.zone_index - b.zone_index);
          }
        }
        // Libellés de référence mis à jour : on aligne les tours existants.
        const labels = new Map(GUIDED_ZONES.flatMap((z) => z.points.map((p) => [p.key, p.label] as const)));
        for (const row of rows) {
          const label = labels.get(row.point_key);
          if (label && label !== row.point_label) {
            row.point_label = label;
            await supabase.from("inspection_points").update({ point_label: label }).eq("id", row.id);
          }
        }
      }
      return rows;
    },
  });

  // Les zones sont dérivées des points enregistrés : un tour déjà commencé
  // conserve son ordre d'origine même si la liste de référence évolue.
  const zones = useMemo(() => {
    const map = new Map<number, { index: number; label: string; key: string }>();
    for (const p of points.data ?? []) {
      if (!map.has(p.zone_index)) {
        map.set(p.zone_index, {
          index: p.zone_index,
          label: p.zone_label,
          key: (p as unknown as { zone_key: string }).zone_key,
        });
      }
    }
    if (map.size === 0) {
      return GUIDED_ZONES.map((z, i) => ({ index: i + 1, label: z.label, key: z.key }));
    }
    return [...map.values()].sort((a, b) => a.index - b.index);
  }, [points.data]);

  const zoneCount = zones.length;
  const position = Math.max(1, zones.findIndex((z) => z.index === zone) + 1);
  const current = zones[position - 1] ?? zones[0]!;
  const zoneDef =
    GUIDED_ZONES.find((z) => z.key === current.key) ?? GUIDED_ZONES[current.index - 1] ?? GUIDED_ZONES[0]!;
  const zonePoints = (points.data ?? [])
    .filter((p) => p.zone_index === current.index)
    .sort((a, b) => {
      const order = (k: string) => {
        const i = zoneDef.points.findIndex((d) => d.key === k);
        return i === -1 ? 999 : i;
      };
      return order(a.point_key) - order(b.point_key);
    });

  const counts = useMemo(() => {
    const all = points.data ?? [];
    return {
      total: all.length,
      ok: all.filter((p) => p.status === "ok").length,
      watch: all.filter((p) => p.status === "watch").length,
      defect: all.filter((p) => p.status === "defect").length,
      unset: all.filter((p) => p.status === "unset").length,
    };
  }, [points.data]);

  async function goto(nextPosition: number) {
    const target = zones[nextPosition - 1];
    if (!target) return;
    setZone(target.index);
    window.scrollTo({ top: 0 });
    await supabase
      .from("vehicle_inspections")
      .update({ current_zone_index: target.index })
      .eq("id", props.tourId);
  }

  // §10 — pneus à chiffrer sans référence complète confirmée sur l'essieu.
  // Une monte complète mémorisée sur la fiche véhicule vaut confirmation
  // d'essieu, exactement comme dans TireWheelCard.
  const axleConfirmed = useMemo(() => {
    const set = new Set<string>();
    if (parseTireReference(props.tireSizeFront).complete) set.add("av");
    if (parseTireReference(props.tireSizeRear ?? props.tireSizeFront).complete) set.add("ar");
    for (const p of points.data ?? []) {
      if (!/^pneu_/.test(p.point_key)) continue;
      const ta = (
        p as unknown as {
          tire_analysis?: {
            confirmedRef?: string | null;
            final?: { size?: string | null; load_index?: string | null; speed_index?: string | null } | null;
            ai?: { size?: string | null; load_index?: string | null; speed_index?: string | null } | null;
          } | null;
        }
      ).tire_analysis;
      const r = ta?.final ?? ta?.ai ?? null;
      const read = [r?.size, r?.load_index, r?.speed_index].filter(Boolean).join(" ");
      if (parseTireReference(ta?.confirmedRef).complete || parseTireReference(read).complete) {
        set.add(p.point_key.includes("av") ? "av" : "ar");
      }
    }
    return set;
  }, [points.data, props.tireSizeFront, props.tireSizeRear]);

  const tiresWithoutSize = useMemo(
    () =>
      (points.data ?? []).filter(
        (p) =>
          /^pneu_/.test(p.point_key) &&
          (p.status === "watch" || p.status === "defect") &&
          !axleConfirmed.has(p.point_key.includes("av") ? "av" : "ar"),
      ),
    [points.data, axleConfirmed],
  );
  const [tireWarnOpen, setTireWarnOpen] = useState(false);

  const uploads = useUploadState();
  const blockClose = uploads.pending > 0 || uploads.failed.length > 0;

  // §15 — contrôle qualité : écarts visibles, jamais bloquants.
  const qualityIssues = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const all = points.data ?? [];
    if (mileage == null) out.push({ key: "kilometrage", label: "Kilométrage non enregistré" });
    for (const p of all) {
      if ((p.status === "watch" || p.status === "defect") && !(p.comment ?? "").trim()) {
        out.push({ key: p.point_key, label: `${p.point_label} : anomalie sans commentaire` });
      }
      const battery = (p as unknown as { battery_test?: unknown }).battery_test;
      if (p.point_key === "batterie" && p.status !== "unset" && !battery && !p.measure_value) {
        out.push({ key: p.point_key, label: "Batterie : aucun résultat de test exploité" });
      }
      const tire = (p as unknown as { tire_analysis?: { size?: string | null } | null }).tire_analysis;
      if (/^pneu_/.test(p.point_key) && (p.status === "watch" || p.status === "defect") && !tire?.size) {
        out.push({ key: p.point_key, label: `${p.point_label} : dimension pneumatique non exploitable` });
      }
    }
    return out;
  }, [points.data, mileage]);

  async function finish(opts?: { withoutTireSize?: boolean }) {
    if (!user) return;
    if (props.editingCompleted) {
      // Modification d'un tour déjà clôturé : on ne rejoue pas la clôture.
      try {
        await markTourModified(props.tourId, { userId: user.id, userName: displayName || null });
        toast.success("Modifications enregistrées");
      } catch (e) {
        console.error(e);
        toast.error("Modifications non enregistrées");
        return;
      }
      navigate({ to: "/tour/$tourId/rapport", params: { tourId: props.tourId } });
      return;
    }
    const ok = await finishTour({
      tourId: props.tourId,
      userId: user.id,
      userName: displayName || "Utilisateur",
      source: opts?.withoutTireSize
        ? "bouton_terminer_sans_dimension_pneu"
        : "bouton_terminer",
    });
    if (!ok) return;
    navigate({ to: "/tour/$tourId/rapport", params: { tourId: props.tourId } });
  }

  if (showSummary) {
    return (
      <AppShell title="Tour véhicule terminé" subtitle={props.plate}>
        <div className="space-y-4">
          <section className="card-surface space-y-1 p-4 text-sm">
            <Row label="Points contrôlés" value={`${counts.total - counts.unset} / ${counts.total}`} />
            <Row label="OK" value={String(counts.ok)} />
            <Row label="À surveiller" value={String(counts.watch)} />
            <Row label="Défauts" value={String(counts.defect)} />
            <Row label="Non renseignés" value={String(counts.unset)} />
            <Row label="Kilométrage" value={mileage ? `${mileage.toLocaleString("fr-FR")} km` : "—"} />
          </section>
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Anomalies relevées
            </h2>
            {(points.data ?? [])
              .filter((p) => p.status === "watch" || p.status === "defect")
              .map((p) => (
                <div key={p.id} className="card-surface flex items-center justify-between gap-2 p-3">
                  <div>
                    <div className="text-sm font-semibold">{p.point_label}</div>
                    <div className="text-xs text-muted-foreground">{p.zone_label}</div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            {counts.watch + counts.defect === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune anomalie relevée.</p>
            ) : null}
          </section>
          {qualityIssues.length ? (
            <section className="rounded-xl border-2 border-status-watch bg-status-watch-soft p-3">
              <p className="text-sm font-extrabold uppercase text-status-watch">
                {qualityIssues.length} élément(s) restent à vérifier
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-status-watch">
                {qualityIssues.map((q, i) => (
                  <li key={`${q.key}-${i}`}>{q.label}</li>
                ))}
              </ul>
              <button
                onClick={() => setShowSummary(false)}
                className="mt-2 text-xs font-bold uppercase underline"
              >
                Revenir aux contrôles
              </button>
            </section>
          ) : null}
          <div className="grid gap-2">
            <PendingUploadsGuard />
            <button
              onClick={() => setShowSummary(false)}
              className="rounded-xl border-2 border-border bg-card px-4 py-4 font-bold uppercase"
            >
              Modifier
            </button>
            {tireWarnOpen && tiresWithoutSize.length ? (
              <section className="rounded-xl border-2 border-status-defect bg-status-defect-soft p-3">
                <p className="text-sm font-extrabold uppercase text-status-defect">
                  Pneu(s) à chiffrer sans dimension confirmée
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-status-defect">
                  {tiresWithoutSize.map((p) => (
                    <li key={p.id}>{p.point_label}</li>
                  ))}
                </ul>
                <div className="mt-2 grid gap-2">
                  <button
                    onClick={() => {
                      setTireWarnOpen(false);
                      setShowSummary(false);
                      const first = tiresWithoutSize[0];
                      if (first) void goto(zones.findIndex((z) => z.index === first.zone_index) + 1);
                    }}
                    className="rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground"
                  >
                    Photographier les caractères du pneu
                  </button>
                  <button
                    onClick={() => {
                      setTireWarnOpen(false);
                      setShowSummary(false);
                      const first = tiresWithoutSize[0];
                      if (first) void goto(zones.findIndex((z) => z.index === first.zone_index) + 1);
                    }}
                    className="rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
                  >
                    Saisir la dimension
                  </button>
                  <button
                    onClick={() => void finish({ withoutTireSize: true })}
                    className="rounded-lg border-2 border-status-defect px-3 py-3 text-xs font-extrabold uppercase text-status-defect"
                  >
                    Clôturer quand même sans dimension
                  </button>
                </div>
              </section>
            ) : null}
            <button
              onClick={() => {
                if (
                  !props.editingCompleted &&
                  tiresWithoutSize.length &&
                  !tireWarnOpen
                ) {
                  setTireWarnOpen(true);
                  return;
                }
                void finish();
              }}
              disabled={blockClose}
              className="rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground disabled:opacity-50"
            >
              {props.editingCompleted ? "Enregistrer les modifications" : "Valider et terminer le tour"}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`Zone ${position} / ${zoneCount}`}
      subtitle={current.label.toUpperCase()}
      back={{ to: "/tours" }}
    >
      <TourNav quit={props.quit} deleteDraft={props.deleteDraft} editingCompleted={props.editingCompleted} />
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-brand transition-all"
          style={{ width: `${(position / zoneCount) * 100}%` }}
        />
      </div>

      <div className="-mx-4 mb-3 overflow-x-auto px-4">
        <div className="flex w-max gap-2 pb-1">
          {zones.map((z, i) => {
            const pts = (points.data ?? []).filter((p) => p.zone_index === z.index);
            const done = pts.length > 0 && pts.every((p) => p.status !== "unset");
            const issues = pts.filter((p) => p.status === "watch" || p.status === "defect").length;
            const active = z.index === current.index;
            return (
              <button
                key={z.index}
                type="button"
                onClick={() => void goto(i + 1)}
                aria-current={active ? "step" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-2 text-xs font-bold uppercase ${
                  active
                    ? "border-brand bg-brand text-brand-foreground"
                    : done
                      ? "border-status-ok bg-status-ok-soft text-status-ok"
                      : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span>
                  {i + 1}. {z.label}
                </span>
                {issues > 0 ? (
                  <span className="rounded-full bg-status-defect px-1.5 text-[10px] text-white">
                    {issues}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{zoneDef.hint}</p>

      <div className="space-y-3">
        {zonePoints.map((p) => {
          const def = zoneDef.points.find((d) => d.key === p.point_key);
          if (def?.special === "mileage") {
            return (
              <MileageCard
                key={p.id}
                inspectionId={props.tourId}
                pointId={p.id}
                vehicleId={props.vehicleId}
                previous={props.lastMileage}
                current={mileage}
                onSaved={(v) => {
                  setMileage(v);
                  void supabase.from("inspection_points").update({ status: "ok", measure_value: String(v), measure_unit: "km" }).eq("id", p.id);
                }}
              />
            );
          }
          if (def?.special === "tire_label") {
            return (
              <TireLabelCard
                key={p.id}
                point={p}
                inspectionId={props.tourId}
                onLabel={setTireLabel}
              />
            );
          }
          if (def?.special === "tire") {
            const rear = p.point_key.includes("ar");
            return (
              <TireWheelCard
                key={p.id}
                point={p}
                inspectionId={props.tourId}
                vehicleId={props.vehicleId}
                requiredSize={(rear ? tireLabel?.size_rear : tireLabel?.size_front) ?? tireLabel?.size_front ?? null}
                requiredLoad={(rear ? tireLabel?.load_index_rear : tireLabel?.load_index_front) ?? null}
                requiredSpeed={(rear ? tireLabel?.speed_index_rear : tireLabel?.speed_index_front) ?? null}
              />
            );
          }
          if (def?.special === "ct") {
            return (
              <div key={p.id}>
                <PointCard point={p} def={def} inspectionId={props.tourId} />
                <TechnicalControlCard
                  pointId={p.id}
                  tourId={props.tourId}
                  vehicleId={props.vehicleId}
                  initialCt={(p as unknown as { ct_due_date?: string | null }).ct_due_date ?? props.ctDueDate}
                  initialPollution={(p as unknown as { pollution_due_date?: string | null }).pollution_due_date ?? props.pollutionDueDate}
                />
              </div>
            );
          }
          return <PointCard key={p.id} point={p} def={def} inspectionId={props.tourId} />;
        })}
      </div>

      <div className="mt-5 space-y-2">
        {position < zoneCount ? (
          <div className="card-surface p-4 text-center">
            <p className="text-sm font-bold uppercase">{current.label} terminé</p>
            <p className="text-sm text-muted-foreground">Zone suivante : {zones[position]!.label}</p>
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            disabled={position === 1}
            onClick={() => void goto(position - 1)}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl border-2 border-border bg-card px-3 py-4 font-bold uppercase disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" /> Précédente
          </button>
          {position < zoneCount ? (
            <button
              onClick={() => void goto(position + 1)}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-brand px-3 py-4 font-bold uppercase text-brand-foreground"
            >
              Continuer <ChevronRight className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={() => setShowSummary(true)}
              className="flex-1 rounded-xl bg-brand px-3 py-4 font-bold uppercase text-brand-foreground"
            >
              Terminer le tour
            </button>
          )}
        </div>
        {position < zoneCount ? (
          <button
            onClick={() => setShowSummary(true)}
            className="w-full rounded-xl border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase text-muted-foreground"
          >
            Terminer le tour maintenant
          </button>
        ) : null}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

/* -------------------------------- TOUR LIBRE ------------------------------- */

type ObsRow = {
  id: string;
  category: string;
  element: string;
  status: string;
  measure_value: string | null;
  measure_unit: string | null;
  comment: string | null;
};

function Free(props: SharedProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, displayName } = useAuth();
  const [editing, setEditing] = useState<ObsRow | null>(null);
  const [creating, setCreating] = useState(false);

  const obs = useQuery({
    queryKey: ["observations", props.tourId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("observations")
        .select("*")
        .eq("inspection_id", props.tourId)
        .order("created_at");
      if (error) throw error;
      return data as ObsRow[];
    },
  });

  const photos = useQuery({
    queryKey: ["tour-photos", props.tourId],
    queryFn: async () => {
      const { count } = await supabase
        .from("media")
        .select("id", { count: "exact", head: true })
        .eq("inspection_id", props.tourId);
      return count ?? 0;
    },
  });

  const freeUploads = useUploadState();
  const freeBlockClose = freeUploads.pending > 0 || freeUploads.failed.length > 0;

  async function finish(opts?: { withoutTireSize?: boolean }) {
    if (!user) return;
    if (props.editingCompleted) {
      try {
        await markTourModified(props.tourId, { userId: user.id, userName: displayName || null });
        toast.success("Modifications enregistrées");
      } catch (e) {
        console.error(e);
        toast.error("Modifications non enregistrées");
        return;
      }
      navigate({ to: "/tour/$tourId/rapport", params: { tourId: props.tourId } });
      return;
    }
    const ok = await finishTour({
      tourId: props.tourId,
      userId: user.id,
      userName: displayName || "Utilisateur",
      source: opts?.withoutTireSize
        ? "bouton_terminer_sans_dimension_pneu"
        : "bouton_terminer",
    });
    if (!ok) return;
    navigate({ to: "/tour/$tourId/rapport", params: { tourId: props.tourId } });
  }

  if (creating || editing) {
    return (
      <ObservationForm
        tourId={props.tourId}
        existing={editing}
        onClose={async () => {
          setCreating(false);
          setEditing(null);
          await qc.invalidateQueries({ queryKey: ["observations", props.tourId] });
          await qc.invalidateQueries({ queryKey: ["tour-photos", props.tourId] });
        }}
      />
    );
  }

  return (
    <AppShell
      title="Tour libre"
      subtitle={props.plate}
      back={{ to: "/tours" }}
    >
      <TourNav quit={props.quit} deleteDraft={props.deleteDraft} editingCompleted={props.editingCompleted} />
      <button
        onClick={() => setCreating(true)}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground"
      >
        <Plus className="h-6 w-6" /> Signaler un défaut
      </button>

      <div className="space-y-2">
        {(obs.data ?? []).map((o) => (
          <button
            key={o.id}
            onClick={() => setEditing(o)}
            className="card-surface flex w-full items-start justify-between gap-2 p-4 text-left"
          >
            <div>
              <div className="font-bold">{o.element}</div>
              <div className="text-xs text-muted-foreground">{o.category}</div>
              {o.measure_value ? (
                <div className="text-xs">
                  Mesure : {o.measure_value} {o.measure_unit}
                </div>
              ) : null}
              {o.comment ? <div className="mt-1 text-sm">{o.comment}</div> : null}
            </div>
            <StatusBadge status={o.status} />
          </button>
        ))}
        {obs.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun défaut signalé pour l'instant.
          </p>
        ) : null}
      </div>

      <div className="mt-6 space-y-2">
        <PendingUploadsGuard />
        <p className="text-center text-sm text-muted-foreground">
          {obs.data?.length ?? 0} défaut(s) signalé(s) · {photos.data ?? 0} photo(s)
        </p>
        <button
          onClick={() => void finish()}
          disabled={freeBlockClose}
          className="w-full rounded-xl bg-primary px-4 py-5 text-lg font-extrabold uppercase text-primary-foreground disabled:opacity-50"
        >
          Terminer le tour
        </button>
      </div>
    </AppShell>
  );
}

function ObservationForm({
  tourId,
  existing,
  onClose,
}: {
  tourId: string;
  existing: ObsRow | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(existing?.category ?? "");
  const [element, setElement] = useState(existing?.element ?? "");
  const [status, setStatus] = useState<PointStatus>((existing?.status as PointStatus) ?? "defect");
  const [measure, setMeasure] = useState(existing?.measure_value ?? "");
  const [unit, setUnit] = useState(existing?.measure_unit ?? "mm");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saved, setSaved] = useState<ObsRow | null>(existing);
  const [pendingShots, setPendingShots] = useState<BurstShot[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!category || !element) {
      toast.error("Choisissez une catégorie et un élément");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        inspection_id: tourId,
        category,
        element,
        status: status === "unset" ? "watch" : status,
        measure_value: measure || null,
        measure_unit: measure ? unit : null,
        comment: comment || null,
      };
      let row = saved;
      if (row) {
        await supabase.from("observations").update(payload).eq("id", row.id);
      } else {
        const { data, error } = await supabase.from("observations").insert(payload).select().single();
        if (error) {
          toast.error("Enregistrement impossible");
          return;
        }
        row = data as ObsRow;
        setSaved(row);
      }

      if (pendingShots.length) {
        try {
          for (const shot of pendingShots) {
            await uploadPhoto(shot.blob, `inspections/${tourId}`, {
              inspection_id: tourId,
              observation_id: row.id,
            });
          }
          setPendingShots([]);
        } catch (e) {
          console.error(e);
          toast.error("Défaut enregistré, mais l'envoi de certaines photos a échoué");
          return;
        }
      }

      toast.success(existing ? "Observation mise à jour" : "Défaut enregistré");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!saved) return onClose();
    if (!window.confirm("Supprimer cette observation ?")) return;
    await supabase.from("observations").delete().eq("id", saved.id);
    onClose();
  }

  return (
    <AppShell title={existing ? "Modifier le défaut" : "Signaler un défaut"}>
      <div className="space-y-4">
        <div className="card-surface space-y-3 p-4">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Photo(s) du défaut
          </label>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-status-defect px-4 py-5 text-lg font-extrabold uppercase text-white"
          >
            <Camera className="h-6 w-6" /> Photo(s)
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Prenez les photos avant ou après avoir renseigné le défaut, comme vous voulez.
          </p>
          {pendingShots.length ? (
            <div className="flex flex-wrap gap-2">
              {pendingShots.map((shot, i) => (
                <div key={`${shot.key}-${i}`} className="relative">
                  <img
                    src={shot.dataUrl}
                    alt={shot.label}
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingShots((s) => s.filter((_, idx) => idx !== i))}
                    aria-label="Retirer la photo"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-1 text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {saved ? (
            <PhotoManager
              folder={`inspections/${tourId}`}
              links={{ inspection_id: tourId, observation_id: saved.id }}
            />
          ) : null}
        </div>

        <div className="card-surface space-y-3 p-4">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Catégorie
          </label>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(FREE_CATEGORIES).map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCategory(c);
                  setElement("");
                }}
                className={`rounded-lg border-2 px-2 py-3 text-sm font-semibold ${
                  category === c ? "border-brand bg-brand/20" : "border-border bg-card"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {category ? (
          <div className="card-surface space-y-3 p-4">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Élément
            </label>
            <div className="grid gap-2">
              {(FREE_CATEGORIES[category] ?? []).map((el) => (
                <button
                  key={el}
                  onClick={() => setElement(el)}
                  className={`rounded-lg border-2 px-3 py-3 text-left text-sm font-semibold ${
                    element === el ? "border-brand bg-brand/20" : "border-border bg-card"
                  }`}
                >
                  {el}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card-surface space-y-3 p-4">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Statut
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setStatus("watch")}
              className={`rounded-lg border-2 px-2 py-3 font-semibold ${
                status === "watch" ? "border-status-watch bg-status-watch text-primary" : "border-border bg-card"
              }`}
            >
              À surveiller
            </button>
            <button
              onClick={() => setStatus("defect")}
              className={`rounded-lg border-2 px-2 py-3 font-semibold ${
                status === "defect" ? "border-status-defect bg-status-defect text-white" : "border-border bg-card"
              }`}
            >
              Défaut / à remplacer
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              value={measure}
              onChange={(e) => setMeasure(e.target.value)}
              placeholder="Mesure (facultatif)"
              className="flex-1 rounded-lg border-2 border-border px-3 py-3 outline-none focus:border-brand"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="rounded-lg border-2 border-border px-2 py-3"
            >
              {["mm", "cm", "%", "V", "bar", "L", "km"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Commentaire (facultatif)"
            className="w-full rounded-lg border-2 border-border px-3 py-2 outline-none focus:border-brand"
          />
        </div>

        <div className="grid gap-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button onClick={onClose} className="rounded-xl border-2 border-border bg-card px-4 py-3 font-bold uppercase">
            Retour à la liste
          </button>
          {saved ? (
            <button onClick={() => void remove()} className="py-2 text-sm font-semibold text-destructive">
              Supprimer cette observation
            </button>
          ) : null}
        </div>
      </div>

      {cameraOpen ? (
        <BurstCamera
          steps={[]}
          allowFree={false}
          title="Photo du défaut"
          onFinish={(shots) => {
            setPendingShots((s) => [...s, ...shots]);
            setCameraOpen(false);
          }}
          onCancel={() => setCameraOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}
