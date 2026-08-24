import { supabase } from "@/integrations/supabase/client";
import { normalizePlate } from "./plate";

export const OR_SELECT =
  "id, or_number, internal_ref, or_status, record_type, or_source, or_linked_at, or_date, client_remarks, requested_work, entry_at, delivery_at, mileage_in, created_at, vehicle:vehicles(*), client:clients(*)";

export async function fetchRecentOrders(limit = 20) {
  const { data, error } = await supabase
    .from("repair_orders")
    .select(OR_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
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
      o.internal_ref?.toLowerCase().includes(lower) ||
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
  started_at: string | null;
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
/* ------------------------- Tours véhicule récents ------------------------- */

export type CommStatus = "not_sent" | "sent" | "modified";

export function commStatus(i: {
  last_sent_at: string | null;
  client_content_updated_at: string | null;
}): CommStatus {
  if (!i.last_sent_at) return "not_sent";
  if (i.client_content_updated_at && i.client_content_updated_at > i.last_sent_at) return "modified";
  return "sent";
}

export const COMM_LABELS: Record<CommStatus, string> = {
  not_sent: "Non envoyé",
  sent: "Envoyé au client",
  modified: "Modifié depuis le dernier envoi",
};

export type RecentTour = {
  id: string;
  inspection_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  mileage: number | null;
  last_sent_at: string | null;
  last_sent_to: string | null;
  client_content_updated_at: string | null;
  comm: CommStatus;
  finished_at: string | null;
  duration_seconds: number | null;
  operator_name: string | null;
  defects: number;
  watches: number;
  plate: string;
  brand: string | null;
  model: string | null;
  or_id: string | null;
  or_number: string | null;
  internal_ref: string | null;
  client_name: string;
  archived_at: string | null;
};

/**
 * `scope` : "completed" = historique des tours clôturés (liste principale),
 * "open" = brouillons / tours en cours, "all" = tout.
 */
export type TourScope = "completed" | "open" | "archived" | "all";

export type TourSearch = {
  /** Texte libre : immatriculation, n° OR, référence DDA, client, marque, modèle, opérateur. */
  text?: string;
  from?: string | null;
  to?: string | null;
};

const TOUR_SELECT =
  "id, inspection_type, status, started_at, completed_at, finished_at, updated_at, archived_at, duration_seconds, started_by_name, completed_by_name, created_by_name, mileage, last_sent_at, last_sent_to, client_content_updated_at, inspection_points(status), observations(status), vehicle:vehicles(plate, plate_normalized, brand, model), repair_order:repair_orders(id, or_number, internal_ref, client:clients(first_name, last_name))";

export async function fetchRecentTours(
  limit = 10,
  scope: TourScope = "completed",
  search: TourSearch = {},
): Promise<RecentTour[]> {
  let query = supabase.from("vehicle_inspections").select(TOUR_SELECT);
  if (scope === "completed") query = query.eq("status", "completed").is("archived_at", null);
  if (scope === "open") query = query.neq("status", "completed").is("archived_at", null);
  if (scope === "archived") query = query.not("archived_at", "is", null);

  const text = (search.text ?? "").trim();
  if (text) {
    // Recherche sur l'ensemble de l'historique : véhicule, dossier, client, opérateur.
    const like = `%${text.replace(/[%,()]/g, " ")}%`;
    const norm = normalizePlate(text);
    const vehicleFilter = norm
      ? `plate.ilike.${like},plate_normalized.ilike.%${norm}%,brand.ilike.${like},model.ilike.${like}`
      : `plate.ilike.${like},brand.ilike.${like},model.ilike.${like}`;
    const [vehicles, orders] = await Promise.all([
      supabase.from("vehicles").select("id").or(vehicleFilter).limit(300),
      supabase
        .from("repair_orders")
        .select("id, client:clients(first_name, last_name)")
        .or(`or_number.ilike.${like},internal_ref.ilike.${like}`)
        .limit(300),
    ]);
    const { data: clients } = await supabase
      .from("clients")
      .select("id")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(300);
    let orderIds = (orders.data ?? []).map((o) => o.id as string);
    if ((clients ?? []).length) {
      const { data: clientOrders } = await supabase
        .from("repair_orders")
        .select("id")
        .in("client_id", (clients ?? []).map((c) => c.id as string))
        .limit(500);
      orderIds = [...new Set([...orderIds, ...(clientOrders ?? []).map((o) => o.id as string)])];
    }
    const vehicleIds = (vehicles.data ?? []).map((v) => v.id as string);
    const ors: string[] = [
      `started_by_name.ilike.${like}`,
      `completed_by_name.ilike.${like}`,
      `created_by_name.ilike.${like}`,
    ];
    if (vehicleIds.length) ors.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
    if (orderIds.length) ors.push(`repair_order_id.in.(${orderIds.join(",")})`);
    query = query.or(ors.join(","));
  }
  if (search.from) query = query.gte("started_at", search.from);
  if (search.to) query = query.lte("started_at", search.to);

  // Ordre chronologique métier : clôture pour les tours terminés, activité sinon.
  if (scope === "completed") {
    query = query.order("completed_at", { ascending: false, nullsFirst: false });
  } else if (scope === "open") {
    query = query.order("updated_at", { ascending: false }).order("started_at", { ascending: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return (data ?? []).map((i) => {
    const pts = (i.inspection_points ?? []) as { status: string }[];
    const obs = (i.observations ?? []) as { status: string }[];
    const v = (i.vehicle ?? null) as { plate?: string; brand?: string; model?: string } | null;
    const o = (i.repair_order ?? null) as {
      id?: string;
      or_number?: string;
      internal_ref?: string;
      client?: { first_name?: string; last_name?: string } | null;
    } | null;
    return {
      id: i.id,
      inspection_type: i.inspection_type,
      status: i.status,
      started_at: i.started_at,
      completed_at: i.completed_at,
      finished_at: i.finished_at,
      duration_seconds: i.duration_seconds,
      operator_name: i.completed_by_name ?? i.started_by_name ?? i.created_by_name ?? null,
      mileage: i.mileage,
      last_sent_at: i.last_sent_at,
      last_sent_to: i.last_sent_to,
      client_content_updated_at: i.client_content_updated_at,
      comm: commStatus(i),
      defects:
        pts.filter((p) => p.status === "defect").length +
        obs.filter((p) => p.status === "defect").length,
      watches:
        pts.filter((p) => p.status === "watch").length +
        obs.filter((p) => p.status === "watch").length,
      plate: v?.plate ?? "",
      brand: v?.brand ?? null,
      model: v?.model ?? null,
      or_id: o?.id ?? null,
      or_number: o?.or_number ?? null,
      internal_ref: o?.internal_ref ?? null,
      archived_at: (i as { archived_at?: string | null }).archived_at ?? null,
      client_name: [o?.client?.first_name, o?.client?.last_name].filter(Boolean).join(" "),
    };
  });
}

/** Recherche un OR existant par n° OR + immatriculation normalisée (anti-doublon). */
export async function findDuplicateOrder(orNumber: string, plate: string) {
  const num = orNumber.trim();
  const norm = normalizePlate(plate);
  if (!num) return { exact: null, sameNumber: [] as { id: string; plate: string }[] };
  const { data } = await supabase.from("repair_orders").select(OR_SELECT).eq("or_number", num);
  const rows = data ?? [];
  const exact = rows.find(
    (o) => (o.vehicle as { plate_normalized?: string } | null)?.plate_normalized === norm,
  );
  return {
    exact: exact ?? null,
    sameNumber: rows
      .filter((o) => o !== exact)
      .map((o) => ({
        id: o.id,
        plate: (o.vehicle as { plate?: string } | null)?.plate ?? "",
      })),
  };
}
