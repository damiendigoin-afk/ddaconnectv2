import { supabase } from "@/integrations/supabase/client";
import { normalizePlate } from "./plate";

export const OR_SELECT =
  "id, or_number, or_date, client_remarks, requested_work, entry_at, delivery_at, mileage_in, created_at, vehicle:vehicles(*), client:clients(*)";

export async function fetchRecentOrders() {
  const { data, error } = await supabase
    .from("repair_orders")
    .select(OR_SELECT)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function searchOrders(term: string) {
  const raw = term.trim();
  if (!raw) return [];
  const plate = normalizePlate(raw);
  const all = await supabase.from("repair_orders").select(OR_SELECT).limit(200);
  if (all.error) throw all.error;
  const lower = raw.toLowerCase();
  return (all.data ?? []).filter((o) => {
    const v = o.vehicle as { plate_normalized?: string; brand?: string; model?: string } | null;
    const c = o.client as { last_name?: string; first_name?: string } | null;
    return (
      (plate && v?.plate_normalized?.includes(plate)) ||
      o.or_number?.toLowerCase().includes(lower) ||
      `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.toLowerCase().includes(lower) ||
      `${v?.brand ?? ""} ${v?.model ?? ""}`.toLowerCase().includes(lower)
    );
  });
}

export async function fetchOrder(id: string) {
  const { data, error } = await supabase.from("repair_orders").select(OR_SELECT).eq("id", id).single();
  if (error) throw error;
  return data;
}

export type InspectionSummary = {
  id: string;
  inspection_type: string;
  status: string;
  current_zone_index: number;
  mileage: number | null;
  started_at: string;
  completed_at: string | null;
  points: number;
  observations: number;
  photos: number;
  anomalies: number;
};

export async function fetchInspections(orderId: string): Promise<InspectionSummary[]> {
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .select(
      "id, inspection_type, status, current_zone_index, mileage, started_at, completed_at, inspection_points(id, status), observations(id), media(id)",
    )
    .eq("repair_order_id", orderId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((i) => {
    const pts = (i.inspection_points ?? []) as { status: string }[];
    return {
      id: i.id,
      inspection_type: i.inspection_type,
      status: i.status,
      current_zone_index: i.current_zone_index,
      mileage: i.mileage,
      started_at: i.started_at,
      completed_at: i.completed_at,
      points: pts.filter((p) => p.status !== "unset").length,
      observations: (i.observations ?? []).length,
      photos: (i.media ?? []).length,
      anomalies: pts.filter((p) => p.status === "watch" || p.status === "defect").length,
    };
  });
}