import { axleMonteLabel, consolidateAxles, readingsFromPoints, type AxleMonte } from "@/lib/tire-axle";

/**
 * Synthèse de la monte par essieu, recalculée à chaque lecture du rapport :
 * toute nouvelle photo analysée sur une roue met à jour l'essieu.
 */
export function TireAxleSummary({
  points,
  media,
}: {
  points: { id: string; point_key?: string | null; tire_analysis?: unknown }[];
  media: { id: string; inspection_point_id: string | null }[];
}) {
  const readings = readingsFromPoints(
    points
      .filter((p) => p.point_key)
      .map((p) => ({ id: p.id, point_key: p.point_key as string, tire_analysis: p.tire_analysis ?? null })),
    media,
  );
  if (!readings.length) return null;
  const montes = consolidateAxles(readings);
  const row = (label: string, m: AxleMonte) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold ${m.status === "conflit" ? "text-status-defect" : m.status === "confirme" ? "" : "text-muted-foreground"}`}
      >
        {axleMonteLabel(m)}
      </span>
    </div>
  );
  return (
    <section className="card-surface p-3">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Monte pneumatique</h2>
      {row("Essieu AV", montes.avant)}
      {row("Essieu AR", montes.arriere)}
    </section>
  );
}
