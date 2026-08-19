import { supabase } from "@/integrations/supabase/client";

export type MaintenanceAlert = {
  id: string;
  site_id: string | null;
  ref_vehicle_id: string | null;
  plate: string | null;
  customer_name: string | null;
  alert_type: string;
  last_km: number | null;
  last_seen_at: string | null;
  km_per_month: number | null;
  due_km: number | null;
  due_date: string | null;
  risk: string;
  status: string;
  notes: string | null;
};

export const ALERT_TYPES = [
  { key: "revision", label: "Révision" },
  { key: "distribution", label: "Distribution" },
  { key: "pneus", label: "Pneumatiques" },
  { key: "freins", label: "Freins" },
  { key: "ct", label: "Contrôle technique" },
  { key: "batterie", label: "Batterie" },
] as const;

export const RISKS = [
  { key: "faible", label: "Faible" },
  { key: "moyen", label: "Moyen" },
  { key: "eleve", label: "Élevé" },
] as const;

export function riskTone(risk: string) {
  if (risk === "eleve") return "bg-status-watch-soft text-status-watch";
  if (risk === "moyen") return "bg-brand/10 text-brand";
  return "bg-secondary text-foreground";
}

export async function listAlerts(): Promise<MaintenanceAlert[]> {
  const { data, error } = await supabase
    .from("maintenance_alerts")
    .select("id, site_id, ref_vehicle_id, plate, customer_name, alert_type, last_km, last_seen_at, km_per_month, due_km, due_date, risk, status, notes")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as MaintenanceAlert[];
}

export async function createAlert(input: Partial<MaintenanceAlert>) {
  const { error } = await supabase.from("maintenance_alerts").insert(input as never);
  if (error) throw error;
}

export async function setAlertStatus(id: string, status: string) {
  const { error } = await supabase.from("maintenance_alerts").update({ status }).eq("id", id);
  if (error) throw error;
}

type MileageRow = { vehicle_id: string | null; mileage: number | null; measured_at: string | null };

/**
 * Recalcule les échéances à partir de l'historique kilométrique :
 * moyenne km/mois puis projection sur le prochain seuil de révision (15 000 km).
 */
export async function rebuildPredictions(intervalKm = 15000): Promise<number> {
  const [{ data, error }, { data: vehs }] = await Promise.all([
    supabase
      .from("vehicle_mileage_history")
      .select("vehicle_id, mileage, measured_at")
      .order("measured_at", { ascending: true })
      .limit(5000),
    supabase.from("ref_vehicles").select("id, plate").limit(5000),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as MileageRow[];
  const plates = new Map(((vehs ?? []) as { id: string; plate: string | null }[]).map((v) => [v.id, v.plate]));

  const byVeh = new Map<string, MileageRow[]>();
  for (const r of rows) {
    const key = r.vehicle_id ?? "";
    if (!key || r.mileage == null || !r.measured_at) continue;
    const list = byVeh.get(key) ?? [];
    list.push(r);
    byVeh.set(key, list);
  }

  const payload: Partial<MaintenanceAlert>[] = [];
  for (const list of byVeh.values()) {
    if (list.length < 2) continue;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const months =
      (new Date(last.measured_at!).getTime() - new Date(first.measured_at!).getTime()) / (1000 * 60 * 60 * 24 * 30.4);
    if (months <= 0.5) continue;
    const perMonth = Math.max(0, Math.round((last.mileage! - first.mileage!) / months));
    if (perMonth <= 0) continue;
    const dueKm = Math.ceil(last.mileage! / intervalKm) * intervalKm;
    const monthsLeft = (dueKm - last.mileage!) / perMonth;
    const due = new Date(last.measured_at!);
    due.setDate(due.getDate() + Math.round(monthsLeft * 30.4));
    payload.push({
      ref_vehicle_id: last.vehicle_id,
      plate: plates.get(last.vehicle_id ?? "") ?? null,
      alert_type: "revision",
      last_km: last.mileage,
      last_seen_at: last.measured_at!.slice(0, 10),
      km_per_month: perMonth,
      due_km: dueKm,
      due_date: due.toISOString().slice(0, 10),
      risk: monthsLeft <= 1 ? "eleve" : monthsLeft <= 3 ? "moyen" : "faible",
      status: "ouverte",
    });
  }

  if (!payload.length) return 0;
  await supabase.from("maintenance_alerts").delete().eq("status", "ouverte").eq("alert_type", "revision");
  const { error: insErr } = await supabase.from("maintenance_alerts").insert(payload as never);
  if (insErr) throw insErr;
  return payload.length;
}