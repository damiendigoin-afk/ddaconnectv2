/**
 * Équivalences véhicules : référentiel générique servant à rapprocher deux
 * modèles pour les opérations généralistes (2008 ↔ Captur, 208 / C3 ↔ Clio…).
 *
 * Règle métier : une équivalence n'est JAMAIS forcée. Le niveau de confiance et
 * la raison du rapprochement sont conservés ; une équivalence douteuse est
 * signalée, pas appliquée silencieusement.
 */
import { supabase } from "@/integrations/supabase/client";

export type Confidence = "fort" | "moyen" | "faible";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  fort: "Rapprochement fiable",
  moyen: "Rapprochement probable",
  faible: "À vérifier",
};

export type VehicleEquivalence = {
  id: string;
  brand_a: string;
  model_a: string;
  brand_b: string;
  model_b: string;
  segment: string | null;
  body_type: string | null;
  generation: string | null;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  confidence: string;
  reason: string | null;
  scope: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export const norm = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Vrai si l'équivalence concerne le modèle demandé (dans un sens ou l'autre). */
export function matchesModel(eq: VehicleEquivalence, model: string): boolean {
  const m = norm(model);
  if (!m) return false;
  return norm(eq.model_a).includes(m) || norm(eq.model_b).includes(m);
}

/** Vrai si l'équivalence reste valable pour l'année du véhicule. */
export function coversYear(eq: VehicleEquivalence, year: number | null | undefined): boolean {
  if (year == null) return true;
  if (eq.year_from != null && year < eq.year_from) return false;
  if (eq.year_to != null && year > eq.year_to) return false;
  return true;
}

/**
 * Modèles équivalents proposés pour un modèle donné, du rapprochement le plus
 * fiable au moins fiable. Les équivalences inactives sont ignorées.
 */
export function equivalentsFor(
  rows: VehicleEquivalence[],
  model: string,
  opts?: { year?: number | null; minConfidence?: Confidence },
): { model: string; brand: string; confidence: string; reason: string | null }[] {
  const order: Record<string, number> = { fort: 0, moyen: 1, faible: 2 };
  const min = order[opts?.minConfidence ?? "faible"] ?? 2;
  return rows
    .filter((e) => e.active && matchesModel(e, model) && coversYear(e, opts?.year))
    .filter((e) => (order[e.confidence] ?? 2) <= min)
    .sort((a, b) => (order[a.confidence] ?? 2) - (order[b.confidence] ?? 2))
    .map((e) => {
      const reversed = norm(e.model_a).includes(norm(model));
      return {
        model: reversed ? e.model_b : e.model_a,
        brand: reversed ? e.brand_b : e.brand_a,
        confidence: e.confidence,
        reason: e.reason,
      };
    });
}

/** Recherche texte simple sur marque, modèle, segment, carrosserie, motorisation. */
export function searchEquivalences(rows: VehicleEquivalence[], query: string): VehicleEquivalence[] {
  const q = norm(query);
  if (!q) return rows;
  return rows.filter((e) =>
    [e.brand_a, e.model_a, e.brand_b, e.model_b, e.segment, e.body_type, e.generation, e.engine, e.reason]
      .map(norm)
      .some((v) => v.includes(q)),
  );
}

export async function fetchEquivalences(): Promise<VehicleEquivalence[]> {
  const { data, error } = await supabase
    .from("vehicle_equivalences")
    .select("*")
    .order("model_a", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VehicleEquivalence[];
}

export async function saveEquivalence(
  row: Partial<VehicleEquivalence> & { id?: string; created_by?: string | null },
) {
  const payload = { ...row, updated_at: new Date().toISOString() };
  if (row.id) {
    const { error } = await supabase.from("vehicle_equivalences").update(payload as never).eq("id", row.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("vehicle_equivalences").insert(payload as never);
  if (error) throw error;
}
