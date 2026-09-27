/**
 * Consolidation de la monte pneumatique : roue puis essieu.
 *
 * Chaque roue fournit au plus une lecture (référence confirmée > correction
 * opérateur > lecture IA), étayée par ses photos. Les lectures des roues d'un
 * même essieu — y compris une roue jugée OK — sont agrégées. Aucune valeur
 * n'est jamais recopiée d'un essieu à l'autre. En cas de lectures
 * contradictoires, rien n'est choisi : l'essieu reste « à confirmer ».
 */
import { parseTireReference } from "./tires";

export type TireAxleKey = "avant" | "arriere";

export type WheelReading = {
  pointId: string;
  pointKey: string;
  axle: TireAxleKey;
  size: string | null;
  load: string | null;
  speed: string | null;
  /** Photos du point ayant servi à la lecture. */
  photoIds: string[];
  /** Référence confirmée ou corrigée par un opérateur. */
  confirmed: boolean;
  /** Lecture IA de la dimension jugée nette. */
  sharp: boolean;
};

export type AxleConflict = { field: "size" | "load" | "speed"; values: string[] };

export type AxleMonte = {
  axle: TireAxleKey;
  size: string | null;
  load: string | null;
  speed: string | null;
  /** confirme : plusieurs preuves concordantes ou référence confirmée ; propose : une seule lecture. */
  status: "confirme" | "propose" | "conflit" | "inconnu";
  wheels: number;
  photos: number;
  photoIds: string[];
  sourcePointIds: string[];
  conflicts: AxleConflict[];
};

type AnalysisLike = {
  confirmedRef?: string | null;
  final?: { size?: string | null; load_index?: string | null; speed_index?: string | null } | null;
  ai?: {
    size?: string | null;
    load_index?: string | null;
    speed_index?: string | null;
    confidence?: { size?: string | null } | null;
  } | null;
};

export function axleOfPointKey(pointKey: string): TireAxleKey | null {
  if (!/^pneu_/.test(pointKey)) return null;
  return /^pneu_ar/.test(pointKey) ? "arriere" : /^pneu_av/.test(pointKey) ? "avant" : null;
}

function cleanIndex(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim().toUpperCase();
  return s ? s : null;
}

/** Lecture unique d'une roue à partir de son `tire_analysis`. */
export function wheelReading(
  point: { id: string; point_key: string; tire_analysis: unknown },
  photoIds: string[] = [],
): WheelReading | null {
  const axle = axleOfPointKey(point.point_key);
  if (!axle) return null;
  const a = (point.tire_analysis ?? null) as AnalysisLike | null;
  if (!a) return null;
  const confirmedRef = parseTireReference(a.confirmedRef ?? null);
  const src = a.final ?? a.ai ?? null;
  const fromSrc = parseTireReference(src?.size ?? null);
  const size = confirmedRef.size ?? fromSrc.size ?? null;
  const load = confirmedRef.load ?? cleanIndex(src?.load_index) ?? fromSrc.load;
  const speed = confirmedRef.speed ?? cleanIndex(src?.speed_index) ?? fromSrc.speed;
  if (!size && !load && !speed) return null;
  return {
    pointId: point.id,
    pointKey: point.point_key,
    axle,
    size,
    load,
    speed,
    photoIds,
    confirmed: Boolean(confirmedRef.size) || Boolean(a.final && a.final !== a.ai),
    sharp: a.ai?.confidence?.size === "elevee",
  };
}

function vote(values: (string | null)[]): { value: string | null; conflict: string[] | null } {
  const distinct = [...new Set(values.filter((v): v is string => Boolean(v)))];
  if (distinct.length === 0) return { value: null, conflict: null };
  if (distinct.length === 1) return { value: distinct[0] ?? null, conflict: null };
  return { value: null, conflict: distinct };
}

export function consolidateAxle(axle: TireAxleKey, readings: WheelReading[]): AxleMonte {
  const own = readings.filter((r) => r.axle === axle);
  const size = vote(own.map((r) => r.size));
  const load = vote(own.map((r) => r.load));
  const speed = vote(own.map((r) => r.speed));
  const conflicts: AxleConflict[] = [];
  if (size.conflict) conflicts.push({ field: "size", values: size.conflict });
  if (load.conflict) conflicts.push({ field: "load", values: load.conflict });
  if (speed.conflict) conflicts.push({ field: "speed", values: speed.conflict });
  const withSize = own.filter((r) => r.size);
  const photoIds = [...new Set(own.flatMap((r) => r.photoIds))];
  let status: AxleMonte["status"] = "inconnu";
  if (conflicts.length) status = "conflit";
  else if (size.value) {
    const strong = withSize.length >= 2 || withSize.some((r) => r.confirmed) || photoIds.length >= 2;
    status = strong ? "confirme" : "propose";
  }
  return {
    axle,
    size: size.conflict ? null : size.value,
    load: load.conflict ? null : load.value,
    speed: speed.conflict ? null : speed.value,
    status,
    wheels: withSize.length,
    photos: photoIds.length,
    photoIds,
    sourcePointIds: own.map((r) => r.pointId),
    conflicts,
  };
}

export function consolidateAxles(readings: WheelReading[]): Record<TireAxleKey, AxleMonte> {
  return { avant: consolidateAxle("avant", readings), arriere: consolidateAxle("arriere", readings) };
}

/** Lectures de tous les points pneus (tout statut), avec leurs photos. */
export function readingsFromPoints(
  points: { id: string; point_key: string; tire_analysis: unknown }[],
  media: { id: string; inspection_point_id: string | null }[] = [],
): WheelReading[] {
  return points
    .map((p) =>
      wheelReading(
        p,
        media.filter((m) => m.inspection_point_id === p.id).map((m) => m.id),
      ),
    )
    .filter((r): r is WheelReading => Boolean(r));
}

/** Deux essieux fusionnables en « 4 PNEUS » : montes consolidées identiques et sans conflit. */
export function axlesIdentical(front: AxleMonte, rear: AxleMonte): boolean {
  if (front.status === "conflit" || rear.status === "conflit") return false;
  if (!front.size || !rear.size || front.size !== rear.size) return false;
  if (front.load && rear.load && front.load !== rear.load) return false;
  if (front.speed && rear.speed && front.speed !== rear.speed) return false;
  return true;
}

export function monteDisplay(m: Pick<AxleMonte, "size" | "load" | "speed">): string | null {
  if (!m.size) return null;
  const ref = parseTireReference(`${m.size} ${m.load ?? ""}${m.speed ?? ""}`);
  return ref.display || m.size;
}

/** Libellé court : « 155/65 R14 75T · confirmé par 4 photos ». */
export function axleMonteLabel(m: AxleMonte): string {
  if (m.status === "conflit") {
    return `à confirmer — lectures contradictoires : ${m.conflicts.map((c) => c.values.join(" / ")).join(" ; ")}`;
  }
  const ref = monteDisplay(m);
  if (!ref) return "dimension à confirmer";
  const proof = m.photos
    ? `${m.photos} photo${m.photos > 1 ? "s" : ""}`
    : `${m.wheels} roue${m.wheels > 1 ? "s" : ""}`;
  return m.status === "confirme" ? `${ref} · confirmé par ${proof}` : `${ref} · une lecture, à confirmer`;
}
