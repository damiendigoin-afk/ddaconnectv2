import { supabase } from "@/integrations/supabase/client";
import { BUCKET, compressImage } from "./photo";

/* ----------------------------- Référentiels ----------------------------- */

export const EXPERTISE_TYPES = [
  { key: "reprise", label: "Reprise / Achat" },
  { key: "vo", label: "Véhicule Occasion / Vente" },
  { key: "carrosserie", label: "Carrosserie" },
  { key: "etat_des_lieux", label: "État des lieux" },
  { key: "autre", label: "Autre" },
] as const;

export const KEYS_OPTIONS = ["0", "1", "2", "3+"] as const;

export const REG_DOC_OPTIONS = [
  { key: "presente", label: "Présente" },
  { key: "absente", label: "Absente" },
  { key: "non_verifiee", label: "Non vérifiée" },
] as const;

export const CONDITIONS = [
  { key: "tres_bon", label: "Très bon" },
  { key: "bon", label: "Bon" },
  { key: "moyen", label: "Moyen" },
  { key: "mauvais", label: "Mauvais" },
] as const;

export type PhotoStep = {
  key: string;
  label: string;
  category: "exterieur" | "interieur";
  required: boolean;
  /** Indication de cadrage affichée avec la silhouette. */
  hint: string;
};

export const EXTERIOR_STEPS: PhotoStep[] = [
  { key: "face_avant", label: "Face avant", category: "exterieur", required: true, hint: "Face au véhicule, à 2 m" },
  { key: "34_avant_gauche", label: "3/4 avant gauche", category: "exterieur", required: true, hint: "Angle avant gauche" },
  { key: "cote_gauche", label: "Côté gauche", category: "exterieur", required: true, hint: "Profil complet gauche" },
  { key: "34_arriere_gauche", label: "3/4 arrière gauche", category: "exterieur", required: true, hint: "Angle arrière gauche" },
  { key: "face_arriere", label: "Face arrière", category: "exterieur", required: true, hint: "Face arrière, à 2 m" },
  { key: "34_arriere_droit", label: "3/4 arrière droit", category: "exterieur", required: true, hint: "Angle arrière droit" },
  { key: "cote_droit", label: "Côté droit", category: "exterieur", required: true, hint: "Profil complet droit" },
  { key: "34_avant_droit", label: "3/4 avant droit", category: "exterieur", required: true, hint: "Angle avant droit" },
];

export const INTERIOR_STEPS_VP: PhotoStep[] = [
  { key: "poste_conduite", label: "Poste de conduite", category: "interieur", required: true, hint: "Tableau de bord et volant" },
  { key: "sieges_avant", label: "Sièges avant", category: "interieur", required: true, hint: "Porte avant ouverte" },
  { key: "sieges_arriere", label: "Sièges arrière", category: "interieur", required: false, hint: "Porte arrière ouverte" },
  { key: "coffre", label: "Coffre", category: "interieur", required: true, hint: "Coffre ouvert" },
];

export const INTERIOR_STEPS_VU: PhotoStep[] = [
  { key: "cabine", label: "Cabine", category: "interieur", required: true, hint: "Vue d'ensemble cabine" },
  { key: "poste_conduite", label: "Tableau de bord", category: "interieur", required: true, hint: "Tableau de bord et volant" },
  { key: "banquette", label: "Banquette", category: "interieur", required: false, hint: "Banquette passagers" },
  { key: "zone_chargement", label: "Zone de chargement", category: "interieur", required: true, hint: "Volume de charge" },
  { key: "portes_arriere", label: "Portes arrière", category: "interieur", required: false, hint: "Portes ouvertes" },
];

export function interiorSteps(bodyType: string | null | undefined): PhotoStep[] {
  return bodyType === "utilitaire" ? INTERIOR_STEPS_VU : INTERIOR_STEPS_VP;
}

export const DAMAGE_TYPES = [
  "Rayure",
  "Enfoncement / Bosselage",
  "Éclat / Bris",
  "Cassure",
  "Pièce manquante",
  "Déchirure",
  "Tache / usure intérieure",
  "Autre",
] as const;

export const VEHICLE_ZONES = [
  "Pare-chocs avant",
  "Capot",
  "Aile avant gauche",
  "Porte avant gauche",
  "Porte arrière gauche",
  "Bas de caisse gauche",
  "Aile arrière gauche",
  "Pare-chocs arrière",
  "Hayon / coffre",
  "Aile arrière droite",
  "Porte arrière droite",
  "Porte avant droite",
  "Bas de caisse droit",
  "Aile avant droite",
  "Pare-brise",
  "Jante AVG",
  "Jante AVD",
  "Jante ARG",
  "Jante ARD",
  "Habitacle",
  "Autre",
] as const;

export const ACTIONS = [
  { key: "aucune", label: "Aucune intervention" },
  { key: "polissage", label: "Polissage / rénovation" },
  { key: "debosselage", label: "Débosselage sans peinture" },
  { key: "peinture", label: "Peinture" },
  { key: "reparation_peinture", label: "Réparation + peinture" },
  { key: "remplacement", label: "Remplacement" },
  { key: "a_expertiser", label: "À expertiser" },
] as const;

export const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  completed: "Terminée",
  sent: "Envoyée",
};

export const STEPS = [
  { key: "identite", label: "Identification" },
  { key: "compteur", label: "Compteur" },
  { key: "exterieur", label: "Tour extérieur" },
  { key: "interieur", label: "Intérieur" },
  { key: "etat", label: "État général" },
  { key: "dommages", label: "Dommages" },
] as const;

/* -------------------------------- Types -------------------------------- */

export type Expertise = {
  id: string;
  vehicle_id: string | null;
  client_id: string | null;
  repair_order_id: string | null;
  site_id: string | null;
  expertise_type: string;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  version: string | null;
  first_registration: string | null;
  energy: string | null;
  color: string | null;
  owner_name: string | null;
  mileage: number | null;
  keys_count: string | null;
  registration_doc: string;
  exterior_condition: string | null;
  interior_condition: string | null;
  general_comment: string | null;
  status: string;
  step: string;
  share_token: string;
  created_by: string | null;
  created_by_name: string | null;
  completed_at: string | null;
  last_sent_at: string | null;
  last_sent_to: string | null;
  created_at: string;
};

export type ExpertisePhoto = {
  id: string;
  expertise_id: string;
  photo_type: string;
  category: string;
  label: string | null;
  sequence: number;
  required: boolean;
  storage_path: string;
  report_path: string | null;
  created_at: string;
};

export type Annotation = {
  number: number;
  /** Points normalisés (0→1) du tracé réalisé au doigt. */
  path: { x: number; y: number }[];
};

export type ExpertiseDamage = {
  id: string;
  expertise_id: string;
  photo_id: string | null;
  damage_number: number;
  damage_type: string | null;
  vehicle_zone: string | null;
  recommended_action: string | null;
  comment: string | null;
  estimated_cost: number | null;
  cost_pending: boolean;
  annotation_data: unknown;
  created_at: string;
};

export type PriceRule = {
  id: string;
  damage_type: string | null;
  action: string;
  label: string;
  amount: number | null;
  manual_only: boolean;
  active: boolean;
};

/* ------------------------------- Requêtes ------------------------------- */

export async function createExpertise(input: Partial<Expertise>): Promise<Expertise> {
  const { data, error } = await supabase
    .from("vehicle_expertises")
    .insert(input as never)
    .select()
    .single();
  if (error) throw error;
  return data as Expertise;
}

export async function updateExpertise(id: string, patch: Partial<Expertise>) {
  const { error } = await supabase.from("vehicle_expertises").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function fetchExpertise(by: { id?: string; token?: string }) {
  let q = supabase.from("vehicle_expertises").select("*");
  q = by.id ? q.eq("id", by.id) : q.eq("share_token", by.token!);
  const { data, error } = await q.single();
  if (error) throw error;
  const expertise = data as Expertise;
  const [photos, damages] = await Promise.all([
    supabase
      .from("expertise_photos")
      .select("*")
      .eq("expertise_id", expertise.id)
      .order("sequence")
      .order("created_at"),
    supabase
      .from("expertise_damages")
      .select("*")
      .eq("expertise_id", expertise.id)
      .order("damage_number"),
  ]);
  return {
    expertise,
    photos: (photos.data ?? []) as ExpertisePhoto[],
    damages: (damages.data ?? []) as ExpertiseDamage[],
  };
}

export type ExpertiseData = Awaited<ReturnType<typeof fetchExpertise>>;

export type RecentExpertise = Expertise & { damages: number; cost: number; pending: number };

export async function fetchRecentExpertises(limit = 5): Promise<RecentExpertise[]> {
  const { data, error } = await supabase
    .from("vehicle_expertises")
    .select("*, expertise_damages(estimated_cost, cost_pending)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((e) => {
    const d = ((e as { expertise_damages?: { estimated_cost: number | null; cost_pending: boolean }[] })
      .expertise_damages ?? []);
    return {
      ...(e as Expertise),
      damages: d.length,
      cost: d.reduce((s, x) => s + (Number(x.estimated_cost) || 0), 0),
      pending: d.filter((x) => x.cost_pending || x.estimated_cost == null).length,
    };
  });
}

export async function fetchPriceRules(): Promise<PriceRule[]> {
  const { data, error } = await supabase
    .from("repair_price_rules")
    .select("*")
    .order("amount", { nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as PriceRule[];
}

/** Montant indicatif proposé par le barème pour une action (jamais codé en dur). */
export function suggestCost(
  rules: PriceRule[],
  action: string,
  damageType?: string | null,
): { amount: number | null; manual: boolean } {
  const active = rules.filter((r) => r.active && r.action === action);
  const rule = active.find((r) => r.damage_type && r.damage_type === damageType) ?? active[0];
  if (!rule) return { amount: null, manual: true };
  return { amount: rule.amount == null ? null : Number(rule.amount), manual: rule.manual_only };
}

export function totals(damages: ExpertiseDamage[]) {
  const total = damages.reduce((s, d) => s + (Number(d.estimated_cost) || 0), 0);
  const pending = damages.filter((d) => d.cost_pending || d.estimated_cost == null).length;
  return { total, pending };
}

export function euro(v: number): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

/* -------------------------------- Photos -------------------------------- */

async function put(path: string, blob: Blob) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}

/**
 * Deux versions sont stockées : l'originale (haute définition, conservée) et une
 * version optimisée pour le rapport / PDF (1400 px, JPEG qualité 0.7).
 */
export async function uploadExpertisePhoto(args: {
  expertiseId: string;
  file: Blob;
  photoType: string;
  category: string;
  label: string;
  sequence: number;
  required?: boolean;
  /** Blob déjà annoté à utiliser pour le rapport (dommages entourés). */
  annotated?: Blob | null;
}): Promise<ExpertisePhoto> {
  const folder = `expertises/${args.expertiseId}`;
  const id = crypto.randomUUID();
  const original = await compressImage(new File([args.file], "p.jpg", { type: "image/jpeg" }), 2000, 0.9);
  const reportSource = args.annotated ?? original;
  const report = await compressImage(
    new File([reportSource], "p.jpg", { type: "image/jpeg" }),
    1400,
    0.7,
  );
  const storage_path = `${folder}/${id}.jpg`;
  const report_path = `${folder}/${id}_report.jpg`;
  await put(storage_path, original);
  await put(report_path, report);
  const { data, error } = await supabase
    .from("expertise_photos")
    .insert({
      expertise_id: args.expertiseId,
      photo_type: args.photoType,
      category: args.category,
      label: args.label,
      sequence: args.sequence,
      required: args.required ?? false,
      storage_path,
      report_path,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ExpertisePhoto;
}

/** Remplace uniquement la version rapport (photo originale préservée). */
export async function updateReportImage(photo: ExpertisePhoto, annotated: Blob) {
  const report = await compressImage(
    new File([annotated], "p.jpg", { type: "image/jpeg" }),
    1400,
    0.7,
  );
  const path = photo.report_path ?? `${photo.storage_path.replace(/\.jpg$/, "")}_report.jpg`;
  await put(path, report);
  if (!photo.report_path) {
    await supabase.from("expertise_photos").update({ report_path: path }).eq("id", photo.id);
  }
  return path;
}

export async function deleteExpertisePhoto(photo: ExpertisePhoto) {
  const paths = [photo.storage_path, photo.report_path].filter(Boolean) as string[];
  await supabase.storage.from(BUCKET).remove(paths);
  await supabase.from("expertise_photos").delete().eq("id", photo.id);
}

/* ------------------------------- Dommages ------------------------------- */

export async function addDamage(input: Partial<ExpertiseDamage>): Promise<ExpertiseDamage> {
  const { data, error } = await supabase
    .from("expertise_damages")
    .insert(input as never)
    .select()
    .single();
  if (error) throw error;
  return data as ExpertiseDamage;
}

export async function updateDamage(id: string, patch: Partial<ExpertiseDamage>) {
  const { error } = await supabase.from("expertise_damages").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function deleteDamage(id: string) {
  await supabase.from("expertise_damages").delete().eq("id", id);
}