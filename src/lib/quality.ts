/** Lot 3 — Qualité des données : score de complétude, doublons, fusions, documents à classer. */
import { supabase } from "@/integrations/supabase/client";
import { normalizeName, normalizeRegistration } from "./winmotor/mapping";

/* ------------------------------------------------------------------ */
/* Score de complétude véhicule                                        */
/* ------------------------------------------------------------------ */

export const VEHICLE_FIELDS: { key: string; label: string; weight: number }[] = [
  { key: "registration_display", label: "Immatriculation", weight: 3 },
  { key: "vin", label: "VIN", weight: 2 },
  { key: "brand", label: "Marque", weight: 2 },
  { key: "model", label: "Modèle", weight: 2 },
  { key: "version", label: "Version", weight: 1 },
  { key: "energy", label: "Énergie", weight: 1 },
  { key: "engine_code", label: "Code moteur", weight: 1 },
  { key: "first_registration_date", label: "Mise en circulation", weight: 2 },
  { key: "last_mileage", label: "Kilométrage", weight: 2 },
  { key: "next_ct_date", label: "Prochain contrôle technique", weight: 1 },
  { key: "color", label: "Couleur", weight: 1 },
];

export type Completeness = { score: number; missing: string[] };

export function vehicleCompleteness(v: Record<string, unknown>): Completeness {
  let total = 0;
  let got = 0;
  const missing: string[] = [];
  for (const f of VEHICLE_FIELDS) {
    total += f.weight;
    const value = v[f.key];
    const filled = value !== null && value !== undefined && String(value).trim() !== "";
    if (filled) got += f.weight;
    else missing.push(f.label);
  }
  return { score: total ? Math.round((got / total) * 100) : 0, missing };
}

export function completenessLabel(c: Completeness): string {
  if (!c.missing.length) return "Fiche complète";
  const head = c.missing.slice(0, 2).join(", ").toLowerCase();
  const rest = c.missing.length > 2 ? ` et ${c.missing.length - 2} autre(s)` : "";
  return `Complète à ${c.score} % — manque ${head}${rest}`;
}

/* ------------------------------------------------------------------ */
/* Détection de doublons                                               */
/* ------------------------------------------------------------------ */

export type DuplicateGroup = {
  kind: "vehicle" | "customer";
  key: string;
  reason: string;
  items: { id: string; label: string; detail: string; completeness: number; created_at: string }[];
};

function groupBy<T>(rows: T[], keyOf: (r: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}

type VehRow = {
  id: string;
  registration_display: string | null;
  registration_normalized: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  version: string | null;
  energy: string | null;
  engine_code: string | null;
  color: string | null;
  first_registration_date: string | null;
  last_mileage: number | null;
  next_ct_date: string | null;
  created_at: string;
};

const VEH_COLS =
  "id, registration_display, registration_normalized, vin, brand, model, version, energy, engine_code, color, first_registration_date, last_mileage, next_ct_date, created_at";

export async function findVehicleDuplicates(limit = 2000): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase
    .from("ref_vehicles")
    .select(VEH_COLS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as VehRow[];
  const groups: DuplicateGroup[] = [];

  const byPlate = groupBy(rows, (r) => r.registration_normalized || normalizeRegistration(r.registration_display ?? "") || null);
  for (const [key, items] of byPlate) {
    if (items.length < 2) continue;
    groups.push({
      kind: "vehicle",
      key,
      reason: "Même immatriculation",
      items: items.map((v) => ({
        id: v.id,
        label: v.registration_display ?? key,
        detail: [v.brand, v.model, v.version].filter(Boolean).join(" ") || "Sans description",
        completeness: vehicleCompleteness(v as unknown as Record<string, unknown>).score,
        created_at: v.created_at,
      })),
    });
  }

  const byVin = groupBy(rows, (r) => (r.vin && r.vin.length >= 11 ? r.vin.toUpperCase().replace(/\s/g, "") : null));
  for (const [key, items] of byVin) {
    if (items.length < 2) continue;
    if (groups.some((g) => items.every((i) => g.items.some((x) => x.id === i.id)))) continue;
    groups.push({
      kind: "vehicle",
      key,
      reason: "Même VIN",
      items: items.map((v) => ({
        id: v.id,
        label: v.registration_display ?? key,
        detail: [v.brand, v.model].filter(Boolean).join(" ") || key,
        completeness: vehicleCompleteness(v as unknown as Record<string, unknown>).score,
        created_at: v.created_at,
      })),
    });
  }
  return groups;
}

type CustRow = {
  id: string;
  last_name: string | null;
  first_name: string | null;
  company_name: string | null;
  customer_type: string;
  created_at: string;
};

export async function findCustomerDuplicates(limit = 3000): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, last_name, first_name, company_name, customer_type, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CustRow[];

  const keyOf = (c: CustRow) => {
    const base = c.company_name || [c.last_name, c.first_name].filter(Boolean).join(" ");
    const n = normalizeName(base || "");
    return n && n.length >= 4 ? n : null;
  };

  const groups: DuplicateGroup[] = [];
  for (const [key, items] of groupBy(rows, keyOf)) {
    if (items.length < 2) continue;
    groups.push({
      kind: "customer",
      key,
      reason: "Même nom / raison sociale",
      items: items.map((c) => ({
        id: c.id,
        label: c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "Sans nom",
        detail: c.customer_type === "entreprise" ? "Entreprise" : "Particulier",
        completeness: 0,
        created_at: c.created_at,
      })),
    });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Fusion                                                              */
/* ------------------------------------------------------------------ */

export type MergeActor = { id?: string | null; name?: string | null };

export type MergeEntry = {
  id: string;
  entity_kind: string;
  kept_id: string;
  merged_id: string;
  reason: string | null;
  details: Record<string, unknown>;
  actor_name: string | null;
  created_at: string;
};

export async function listMerges(limit = 100): Promise<MergeEntry[]> {
  const { data, error } = await supabase
    .from("merge_log")
    .select("id, entity_kind, kept_id, merged_id, reason, details, actor_name, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MergeEntry[];
}

/** Complète les champs vides de la fiche conservée avec ceux de la fiche fusionnée.
 *  Ne remplace jamais une valeur déjà renseignée : la donnée la plus fiable reste en place. */
function fillGaps(kept: Record<string, unknown>, merged: Record<string, unknown>, fields: string[]) {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    const cur = kept[f];
    const alt = merged[f];
    const empty = cur === null || cur === undefined || String(cur).trim() === "";
    const hasAlt = alt !== null && alt !== undefined && String(alt).trim() !== "";
    if (empty && hasAlt) patch[f] = alt;
  }
  return patch;
}

export async function mergeVehicles(keptId: string, mergedId: string, actor: MergeActor, reason = "Doublon référentiel") {
  if (keptId === mergedId) throw new Error("Sélectionnez deux fiches différentes.");
  const { data, error } = await supabase.from("ref_vehicles").select("*").in("id", [keptId, mergedId]);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const kept = rows.find((r) => r["id"] === keptId);
  const merged = rows.find((r) => r["id"] === mergedId);
  if (!kept || !merged) throw new Error("Une des fiches véhicule est introuvable : rafraîchissez la liste.");

  const patch = fillGaps(
    kept,
    merged,
    VEHICLE_FIELDS.map((f) => f.key).concat(["vin_normalized", "source_vehicle_id", "last_mileage_at", "last_visit_at"]),
  );
  if (Object.keys(patch).length) {
    const { error: upErr } = await supabase.from("ref_vehicles").update(patch as never).eq("id", keptId);
    if (upErr) throw upErr;
  }

  // rattachement des dépendances au véhicule conservé
  for (const t of ["customer_vehicle_relations", "vehicle_mileage_history"] as const) {
    await supabase.from(t).update({ vehicle_id: keptId } as never).eq("vehicle_id", mergedId);
  }

  const { error: delErr } = await supabase.from("ref_vehicles").delete().eq("id", mergedId);
  if (delErr)
    throw new Error(
      "La fiche à fusionner est encore utilisée par un dossier : ouvrez-la, détachez le dossier concerné, puis relancez la fusion.",
    );

  await supabase.from("merge_log").insert({
    entity_kind: "vehicle",
    kept_id: keptId,
    merged_id: mergedId,
    reason,
    details: { filled: Object.keys(patch) },
    actor_id: actor.id ?? null,
    actor_name: actor.name ?? null,
  } as never);
}

export async function mergeCustomers(keptId: string, mergedId: string, actor: MergeActor, reason = "Doublon référentiel") {
  if (keptId === mergedId) throw new Error("Sélectionnez deux fiches différentes.");
  const { data, error } = await supabase.from("customers").select("*").in("id", [keptId, mergedId]);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const kept = rows.find((r) => r["id"] === keptId);
  const merged = rows.find((r) => r["id"] === mergedId);
  if (!kept || !merged) throw new Error("Une des fiches client est introuvable : rafraîchissez la liste.");

  const patch = fillGaps(kept, merged, [
    "civility", "last_name", "first_name", "company_name", "siret", "siren", "vat_number",
    "source_customer_id", "customer_type",
  ]);
  if (Object.keys(patch).length) {
    const { error: upErr } = await supabase.from("customers").update(patch as never).eq("id", keptId);
    if (upErr) throw upErr;
  }

  for (const t of ["customer_contacts", "customer_addresses", "customer_consents", "customer_vehicle_relations"] as const) {
    await supabase.from(t).update({ customer_id: keptId } as never).eq("customer_id", mergedId);
  }

  const { error: delErr } = await supabase.from("customers").delete().eq("id", mergedId);
  if (delErr)
    throw new Error(
      "La fiche client à fusionner est encore rattachée à un dossier : détachez-le avant de relancer la fusion.",
    );

  await supabase.from("merge_log").insert({
    entity_kind: "customer",
    kept_id: keptId,
    merged_id: mergedId,
    reason,
    details: { filled: Object.keys(patch) },
    actor_id: actor.id ?? null,
    actor_name: actor.name ?? null,
  } as never);
}

/* ------------------------------------------------------------------ */
/* Documents à classer                                                 */
/* ------------------------------------------------------------------ */

export type InboxDoc = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  doc_type: string | null;
  confidence: number | null;
  plate: string | null;
  customer_name: string | null;
  status: string;
  linked_kind: string | null;
  linked_id: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
};

const INBOX_SELECT =
  "id, file_name, storage_path, mime_type, doc_type, confidence, plate, customer_name, status, linked_kind, linked_id, note, created_by_name, created_at";

export async function listInbox(status: "a_classer" | "classe" | "all" = "a_classer"): Promise<InboxDoc[]> {
  let q = supabase.from("inbox_documents").select(INBOX_SELECT).order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as InboxDoc[];
}

export async function classifyInboxDoc(
  id: string,
  linked: { kind: string; id: string | null; note?: string },
  actor: MergeActor,
) {
  const { error } = await supabase
    .from("inbox_documents")
    .update({
      status: "classe",
      linked_kind: linked.kind,
      linked_id: linked.id,
      note: linked.note ?? null,
      classified_by: actor.id ?? null,
      classified_by_name: actor.name ?? null,
      classified_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function reopenInboxDoc(id: string) {
  const { error } = await supabase
    .from("inbox_documents")
    .update({ status: "a_classer", linked_kind: null, linked_id: null, classified_at: null } as never)
    .eq("id", id);
  if (error) throw error;
}
