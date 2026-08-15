import { supabase } from "@/integrations/supabase/client";

export type ReportMedia = { id: string; storage_path: string; inspection_point_id: string | null; observation_id: string | null };

export type ReportData = {
  inspection: {
    id: string;
    inspection_type: string;
    status: string;
    mileage: number | null;
    started_at: string;
    completed_at: string | null;
    share_token: string;
  };
  vehicle: { id: string; plate: string; brand: string | null; model: string | null } | null;
  order: { id: string; or_number: string | null; or_date: string | null } | null;
  points: {
    id: string;
    zone_index: number;
    zone_label: string;
    point_label: string;
    status: string;
    measure_value: string | null;
    measure_unit: string | null;
    comment: string | null;
  }[];
  observations: {
    id: string;
    category: string;
    element: string;
    status: string;
    measure_value: string | null;
    measure_unit: string | null;
    comment: string | null;
  }[];
  media: ReportMedia[];
};

export async function fetchReport(by: { id?: string; token?: string }): Promise<ReportData> {
  let query = supabase
    .from("vehicle_inspections")
    .select(
      "id, inspection_type, status, mileage, started_at, completed_at, share_token, vehicle:vehicles(id, plate, brand, model), repair_order:repair_orders(id, or_number, or_date)",
    );
  query = by.id ? query.eq("id", by.id) : query.eq("share_token", by.token!);
  const { data: insp, error } = await query.single();
  if (error) throw error;

  const [points, observations, media] = await Promise.all([
    supabase
      .from("inspection_points")
      .select("id, zone_index, zone_label, point_label, status, measure_value, measure_unit, comment")
      .eq("inspection_id", insp.id)
      .order("zone_index"),
    supabase
      .from("observations")
      .select("id, category, element, status, measure_value, measure_unit, comment")
      .eq("inspection_id", insp.id)
      .order("created_at"),
    supabase
      .from("media")
      .select("id, storage_path, inspection_point_id, observation_id")
      .eq("inspection_id", insp.id),
  ]);

  return {
    inspection: insp as ReportData["inspection"],
    vehicle: (insp.vehicle ?? null) as ReportData["vehicle"],
    order: (insp.repair_order ?? null) as ReportData["order"],
    points: (points.data ?? []) as ReportData["points"],
    observations: (observations.data ?? []) as ReportData["observations"],
    media: (media.data ?? []) as ReportMedia[],
  };
}